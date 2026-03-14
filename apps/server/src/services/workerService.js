/**
 * Service layer for auto-trainer and auto-search workers.
 * Provides direct DB access to bypass HTTP self-calls, eliminating:
 * - HTTP round-trip overhead
 * - Middleware stack (auth, rate limiting, IP ban check, JSON parse)
 * - JWT token generation/verification
 */
import UserPokemon from '../models/UserPokemon.js'
import Encounter from '../models/Encounter.js'
import Pokemon from '../models/Pokemon.js'
import UserInventory from '../models/UserInventory.js'
import Item from '../models/Item.js'
import { calcStatsForLevel } from '../utils/gameUtils.js'
import { buildMoveLookupByName, buildMovePpStateFromMoves, mergeKnownMovesWithFallback, normalizeMoveName } from '../utils/movePpUtils.js'
import { withActiveUserPokemonFilter } from '../utils/userPokemonQuery.js'
import { resolveEffectivePokemonBaseStats } from '../utils/pokemonFormStats.js'

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const resolveFormStats = (species = {}, formId = null) => {
    return resolveEffectivePokemonBaseStats({
        pokemonLike: species,
        formId: normalizeFormId(formId || species?.defaultFormId || 'normal'),
    })
}

const resolvePokemonForm = (pokemon, formId) => {
    const forms = Array.isArray(pokemon?.forms) ? pokemon.forms : []
    const defaultFormId = normalizeFormId(pokemon?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(formId || defaultFormId)
    let resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId) || null
    let resolvedFormId = requestedFormId

    if (!resolvedForm && forms.length > 0) {
        resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || forms[0]
        resolvedFormId = normalizeFormId(resolvedForm?.formId || defaultFormId)
    }

    return { form: resolvedForm, formId: resolvedFormId }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const formatWildPlayerBattleState = (encounterLike = {}) => {
    const maxHp = Math.max(0, Number(encounterLike?.playerMaxHp) || 0)
    if (maxHp <= 0) return null
    const currentHp = clamp(
        Math.floor(Number.isFinite(Number(encounterLike?.playerCurrentHp)) ? Number(encounterLike?.playerCurrentHp) : maxHp),
        0,
        maxHp
    )

    return {
        pokemonId: encounterLike?.playerPokemonId || null,
        name: String(encounterLike?.playerPokemonName || '').trim() || 'Pokemon của bạn',
        imageUrl: encounterLike?.playerPokemonImageUrl || '',
        level: Math.max(1, Number(encounterLike?.playerPokemonLevel) || 1),
        currentHp,
        maxHp,
        defeated: currentHp <= 0,
    }
}

/**
 * Get user party directly from DB.
 * Replaces: GET /api/party
 * Returns the same shape: { ok: true, party: [slot0..slot5] }
 */
export const getPartyDirect = async (userId) => {
    const party = await UserPokemon.find(withActiveUserPokemonFilter({
        userId,
        location: 'party',
    }))
        .populate('pokemonId')
        .sort({ partyIndex: 1 })

    const allMoveNames = party
        .map((entry) => mergeKnownMovesWithFallback(entry.moves))
        .flat()
    const moveLookupMap = await buildMoveLookupByName(allMoveNames)

    const slots = Array(6).fill(null)
    party.forEach((entry) => {
        if (!entry) return
        const base = entry.pokemonId || {}
        const stats = calcStatsForLevel(resolveFormStats(base, entry.formId), entry.level, base.rarity)
        const plainEntry = entry.toObject()
        plainEntry.stats = stats

        const mergedMoveNames = mergeKnownMovesWithFallback(plainEntry.moves)
        const movePpState = buildMovePpStateFromMoves({
            moveNames: mergedMoveNames,
            movePpState: plainEntry.movePpState,
            moveLookupMap,
        })

        plainEntry.moves = movePpState.map((moveEntry) => ({
            ...(moveLookupMap.get(normalizeMoveName(moveEntry.moveName)) || {}),
            name: moveEntry.moveName,
            currentPp: moveEntry.currentPp,
            maxPp: moveEntry.maxPp,
            pp: moveEntry.currentPp,
        }))
        plainEntry.movePpState = movePpState

        const requestedSlotIndex = Number(entry?.partyIndex)
        if (
            Number.isInteger(requestedSlotIndex)
            && requestedSlotIndex >= 0
            && requestedSlotIndex < slots.length
            && !slots[requestedSlotIndex]
        ) {
            slots[requestedSlotIndex] = plainEntry
            return
        }

        const firstEmpty = slots.findIndex((slot) => slot === null)
        if (firstEmpty !== -1) {
            slots[firstEmpty] = plainEntry
        }
    })

    return { ok: true, party: slots }
}

/**
 * Get active encounter directly from DB.
 * Replaces: GET /api/game/encounter/active
 * Returns the same shape: { ok: true, encounter: {...} | null }
 */
export const getActiveEncounterDirect = async (userId) => {
    const encounter = await Encounter.findOne({ userId, isActive: true }).lean()

    if (!encounter) {
        return { ok: true, encounter: null }
    }

    const pokemon = await Pokemon.findById(encounter.pokemonId)
        .select('name pokedexNumber sprites imageUrl types rarity baseStats forms defaultFormId catchRate')
        .lean()

    if (!pokemon) {
        return { ok: true, encounter: null }
    }

    const { form: resolvedForm, formId } = resolvePokemonForm(pokemon, encounter.formId)
    const formStats = resolvedForm?.stats || null
    const formSprites = resolvedForm?.sprites || null
    const formImageUrl = resolvedForm?.imageUrl || ''
    const baseStats = formStats || pokemon.baseStats

    const scaledStats = calcStatsForLevel(baseStats, encounter.level, pokemon.rarity)

    return {
        ok: true,
        encounter: {
            _id: encounter._id,
            level: encounter.level,
            hp: encounter.hp,
            maxHp: encounter.maxHp,
            mapId: encounter.mapId,
            playerBattle: formatWildPlayerBattleState(encounter),
            pokemon: {
                ...pokemon,
                formId,
                stats: scaledStats,
                form: resolvedForm || null,
                resolvedSprites: formSprites || pokemon.sprites,
                resolvedImageUrl: formImageUrl || pokemon.imageUrl,
            },
        },
    }
}

/**
 * Run from encounter directly via DB.
 * Replaces: POST /api/game/encounter/:id/run
 * Returns: { ok: true } or throws
 */
export const runFromEncounterDirect = async (userId, encounterId) => {
    const encounter = await Encounter.findOne({ _id: encounterId, userId, isActive: true })

    if (!encounter) {
        const error = new Error('Khong tim thay cuoc cham tran hoac da ket thuc')
        error.status = 404
        throw error
    }

    encounter.isActive = false
    encounter.endedAt = new Date()
    await encounter.save()

    return { ok: true, message: 'Da bo chay.' }
}

/**
 * Get available pokeballs from inventory directly.
 * Replaces: GET /api/inventory (filtered for pokeballs)
 * Returns: { ok: true, inventory: [...] }
 */
export const getInventoryDirect = async (userId) => {
    const entries = await UserInventory.find({ userId })
        .populate({
            path: 'itemId',
            model: 'Item',
            select: '_id name type effectType effectValue imageUrl description',
        })
        .lean()

    const inventory = entries
        .filter((entry) => entry?.itemId)
        .map((entry) => ({
            _id: entry._id,
            quantity: entry.quantity || 0,
            item: entry.itemId,
        }))

    return { ok: true, inventory }
}
