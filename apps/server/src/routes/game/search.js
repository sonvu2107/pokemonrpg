import express from 'express'
import { authMiddleware } from '../../middleware/auth.js'
import { createActionGuard } from '../../middleware/actionGuard.js'
import PlayerState from '../../models/PlayerState.js'
import Encounter from '../../models/Encounter.js'
import UserInventory from '../../models/UserInventory.js'
import MapProgress from '../../models/MapProgress.js'
import MapModel from '../../models/Map.js'
import Pokemon from '../../models/Pokemon.js'
import {
    EXP_PER_SEARCH,
    calcMaxHp,
    calcStatsForLevel,
    expToNext,
} from '../../utils/gameUtils.js'
import { getOrderedMapsCached } from '../../utils/orderedMapsCache.js'
import { getItemDropRatesCached, getPokemonDropRatesCached } from '../../utils/dropRateCache.js'
import { resolveEffectivePokemonBaseStats } from '../../utils/pokemonFormStats.js'
import {
    formatWildPlayerBattleState,
    resolvePokemonForm,
    resolveWildPlayerBattleSnapshot,
} from '../../services/wildEncounterService.js'
import {
    buildProgressIndex,
    buildUnlockRequirement,
    ensureMapUnlocked,
    formatMapProgress,
    resolveNextMapInTrack,
    resolveSourceMapForUnlock,
    trackDailyActivity,
    updateMapProgress,
    updatePlayerLevel,
} from '../../services/mapProgressionService.js'
import { hasOwnedPokemonForm } from '../../services/userPokemonOwnershipService.js'

const router = express.Router()

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const getOrderedMaps = getOrderedMapsCached

const searchActionGuard = createActionGuard({
    actionKey: 'game:search',
    cooldownMs: 300,
    message: 'Tìm kiếm quá nhanh. Vui lòng đợi một chút.',
})

router.post('/search', authMiddleware, searchActionGuard, async (req, res, next) => {
    try {
        const { mapSlug } = req.body
        const userId = req.user.userId
        const isAdmin = req.user?.role === 'admin'
        const currentVipLevel = Math.max(0, Number(req.user?.vipTierLevel) || 0)

        const map = await MapModel.findOne({ slug: mapSlug })
        if (!map) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ' })
        }

        const playerLevelState = await PlayerState.findOne({ userId })
            .select('level')
            .lean()
        const currentPlayerLevel = Math.max(1, Number(playerLevelState?.level) || 1)

        const orderedMaps = await getOrderedMaps()
        const mapIndex = orderedMaps.findIndex((entry) => entry._id.toString() === map._id.toString())
        if (mapIndex === -1) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy bản đồ trong thứ tự tiến trình' })
        }

        if (!isAdmin) {
            let progressById = new Map()
            const sourceMap = resolveSourceMapForUnlock(orderedMaps, mapIndex)
            if (sourceMap?._id) {
                const sourceProgress = await MapProgress.findOne({ userId, mapId: sourceMap._id })
                    .select('mapId totalSearches')
                    .lean()
                progressById = buildProgressIndex(sourceProgress ? [sourceProgress] : [])
            }

            const unlockRequirement = buildUnlockRequirement(orderedMaps, mapIndex, progressById, currentPlayerLevel, currentVipLevel)
            const isUnlocked = unlockRequirement.remainingSearches === 0
                && unlockRequirement.remainingPlayerLevels === 0
                && unlockRequirement.remainingVipLevels === 0

            if (!isUnlocked) {
                return res.status(403).json({
                    ok: false,
                    locked: true,
                    message: 'Bản đồ chưa mở khóa',
                    unlock: unlockRequirement,
                })
            }
        }

        const mapProgress = await updateMapProgress(userId, map._id)
        const { playerState, leveledUp, levelsGained } = await updatePlayerLevel(userId)

        await trackDailyActivity(userId, {
            searches: 1,
            mapExp: EXP_PER_SEARCH,
            mapSlug: map.slug,
            mapName: map.name,
        })

        if (!isAdmin) {
            const nextMap = resolveNextMapInTrack(orderedMaps, mapIndex)
            if (nextMap?._id) {
                const requiredToUnlockNext = Math.max(0, map.requiredSearches || 0)
                if (mapProgress.totalSearches >= requiredToUnlockNext) {
                    await ensureMapUnlocked(userId, nextMap._id)
                }
            }
        }

        const encounterRate = typeof map.encounterRate === 'number' ? map.encounterRate : 1
        const itemDropRate = typeof map.itemDropRate === 'number' ? map.itemDropRate : 0
        const shouldDropItem = itemDropRate > 0 && Math.random() < itemDropRate
        let droppedItem = null

        if (shouldDropItem) {
            const itemDropRates = await getItemDropRatesCached(map._id)
            const itemTotalWeight = itemDropRates.reduce((sum, entry) => sum + entry.weight, 0)
            let itemRandom = Math.random() * itemTotalWeight
            let selectedItemDrop = null

            for (const entry of itemDropRates) {
                if (itemRandom < entry.weight) {
                    selectedItemDrop = entry
                    break
                }
                itemRandom -= entry.weight
            }

            if (!selectedItemDrop && itemDropRates.length > 0) {
                selectedItemDrop = itemDropRates[itemDropRates.length - 1]
            }

            if (selectedItemDrop?.itemId) {
                const storedItem = selectedItemDrop.itemId
                droppedItem = {
                    _id: selectedItemDrop.itemId._id,
                    name: storedItem.name,
                    description: storedItem.description || '',
                    imageUrl: storedItem.imageUrl || '',
                }

                await UserInventory.findOneAndUpdate(
                    { userId, itemId: storedItem._id },
                    { $inc: { quantity: 1 } },
                    { upsert: true, new: true }
                )
            }
        }

        if (Math.random() > encounterRate) {
            return res.json({
                ok: true,
                encountered: false,
                message: droppedItem ? `Bạn nhặt được ${droppedItem.name}!` : 'Không tìm thấy Pokemon nào.',
                mapProgress: formatMapProgress(mapProgress),
                itemDrop: droppedItem,
                playerLevel: {
                    level: playerState.level,
                    experience: playerState.experience,
                    expToNext: expToNext(playerState.level),
                    leveledUp,
                    levelsGained,
                },
            })
        }

        const specialPokemonConfigsFromMap = Array.isArray(map.specialPokemonConfigs)
            ? map.specialPokemonConfigs
                .map((entry) => {
                    const pokemonId = String(entry?.pokemonId || '').trim()
                    const formId = String(entry?.formId || '').trim().toLowerCase() || 'normal'
                    const weight = Number(entry?.weight)
                    return {
                        pokemonId,
                        formId,
                        weight: Number.isFinite(weight) && weight > 0 ? weight : 0,
                    }
                })
                .filter((entry) => entry.pokemonId && entry.weight > 0)
            : []

        const specialPokemonConfigs = specialPokemonConfigsFromMap.length > 0
            ? specialPokemonConfigsFromMap
            : (Array.isArray(map.specialPokemonIds)
                ? map.specialPokemonIds
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
                    .map((pokemonId) => ({ pokemonId, formId: 'normal', weight: 1 }))
                : [])

        const specialPokemonEncounterRate = typeof map.specialPokemonEncounterRate === 'number'
            ? clamp(map.specialPokemonEncounterRate, 0, 1)
            : 0

        let selectedPokemonId = null
        let selectedFormId = null
        let encounteredFromSpecialPool = false

        if (specialPokemonConfigs.length > 0 && specialPokemonEncounterRate > 0 && Math.random() < specialPokemonEncounterRate) {
            const specialTotalWeight = specialPokemonConfigs.reduce((sum, entry) => sum + entry.weight, 0)
            let specialRandom = Math.random() * specialTotalWeight

            for (const entry of specialPokemonConfigs) {
                if (specialRandom < entry.weight) {
                    selectedPokemonId = entry.pokemonId
                    selectedFormId = entry.formId || 'normal'
                    break
                }
                specialRandom -= entry.weight
            }

            if (!selectedPokemonId) {
                selectedPokemonId = specialPokemonConfigs[specialPokemonConfigs.length - 1]?.pokemonId || null
                selectedFormId = specialPokemonConfigs[specialPokemonConfigs.length - 1]?.formId || 'normal'
            }

            encounteredFromSpecialPool = Boolean(selectedPokemonId)
        }

        if (!selectedPokemonId) {
            const dropRates = await getPokemonDropRatesCached(map._id)

            if (dropRates.length === 0) {
                return res.json({
                    ok: true,
                    encountered: false,
                    message: droppedItem ? `Bạn nhặt được ${droppedItem.name}!` : 'No pokemon in this area.',
                    mapProgress: formatMapProgress(mapProgress),
                    itemDrop: droppedItem,
                    playerLevel: {
                        level: playerState.level,
                        experience: playerState.experience,
                        expToNext: expToNext(playerState.level),
                        leveledUp,
                        levelsGained,
                    },
                })
            }

            const totalWeight = dropRates.reduce((sum, entry) => sum + entry.weight, 0)
            let random = Math.random() * totalWeight
            let selectedDrop = null

            for (const entry of dropRates) {
                if (random < entry.weight) {
                    selectedDrop = entry
                    break
                }
                random -= entry.weight
            }

            if (!selectedDrop) {
                selectedDrop = dropRates[dropRates.length - 1]
            }

            selectedPokemonId = selectedDrop?.pokemonId || null
            selectedFormId = selectedDrop?.formId || null
        }

        if (!selectedPokemonId) {
            return res.json({
                ok: true,
                encountered: false,
                message: droppedItem ? `Bạn nhặt được ${droppedItem.name}!` : 'No pokemon in this area.',
                mapProgress: formatMapProgress(mapProgress),
                itemDrop: droppedItem,
                playerLevel: {
                    level: playerState.level,
                    experience: playerState.experience,
                    expToNext: expToNext(playerState.level),
                    leveledUp,
                    levelsGained,
                },
            })
        }

        const pokemon = await Pokemon.findById(selectedPokemonId)
            .select('name pokedexNumber sprites imageUrl types rarity baseStats catchRate forms defaultFormId')
            .lean()

        if (!pokemon) {
            return res.status(404).json({ ok: false, message: 'Không tìm thấy Pokemon' })
        }

        await Encounter.updateMany(
            { userId, isActive: true },
            { $set: { isActive: false, endedAt: new Date() } }
        )

        const { form: resolvedForm, formId } = resolvePokemonForm(pokemon, selectedFormId)
        const formSprites = resolvedForm?.sprites || null
        const formImageUrl = resolvedForm?.imageUrl || ''
        const baseStats = resolveEffectivePokemonBaseStats({
            pokemonLike: pokemon,
            formId,
            resolvedForm,
        })

        const level = Math.floor(Math.random() * (map.levelMax - map.levelMin + 1)) + map.levelMin
        const scaledStats = calcStatsForLevel(baseStats, level, pokemon.rarity)
        const maxHp = calcMaxHp(baseStats?.hp, level, pokemon.rarity)
        const hp = maxHp
        const playerBattleSnapshot = await resolveWildPlayerBattleSnapshot(userId)
        const isNewPokedexEntry = !(await hasOwnedPokemonForm(userId, pokemon._id, formId))

        const encounter = await Encounter.create({
            userId,
            mapId: map._id,
            pokemonId: pokemon._id,
            level,
            hp,
            maxHp,
            isShiny: false,
            formId,
            playerPokemonId: playerBattleSnapshot?.playerPokemonId || null,
            playerPokemonName: playerBattleSnapshot?.playerPokemonName || '',
            playerPokemonImageUrl: playerBattleSnapshot?.playerPokemonImageUrl || '',
            playerPokemonLevel: Math.max(1, Number(playerBattleSnapshot?.playerPokemonLevel) || 1),
            playerDefense: Math.max(1, Number(playerBattleSnapshot?.playerDefense) || 1),
            playerTypes: Array.isArray(playerBattleSnapshot?.playerTypes) ? playerBattleSnapshot.playerTypes : [],
            playerCurrentHp: Math.max(0, Number(playerBattleSnapshot?.playerCurrentHp) || 0),
            playerMaxHp: Math.max(0, Number(playerBattleSnapshot?.playerMaxHp) || 0),
        })

        return res.json({
            ok: true,
            encountered: true,
            fromSpecialPool: encounteredFromSpecialPool,
            encounterId: encounter._id,
            pokemon: {
                ...pokemon,
                formId,
                isNewPokedexEntry,
                stats: scaledStats,
                form: resolvedForm || null,
                resolvedSprites: formSprites || pokemon.sprites,
                resolvedImageUrl: formImageUrl || pokemon.imageUrl,
            },
            level,
            hp,
            maxHp,
            playerBattle: formatWildPlayerBattleState(encounter),
            itemDrop: droppedItem,
            mapProgress: formatMapProgress(mapProgress),
            playerLevel: {
                level: playerState.level,
                experience: playerState.experience,
                expToNext: expToNext(playerState.level),
                leveledUp,
                levelsGained,
            },
        })
    } catch (error) {
        return next(error)
    }
})

export default router
