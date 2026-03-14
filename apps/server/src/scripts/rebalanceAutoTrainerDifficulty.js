import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDB } from '../config/db.js'
import BattleTrainer from '../models/BattleTrainer.js'
import Pokemon from '../models/Pokemon.js'

dotenv.config()

const args = process.argv.slice(2)
const argSet = new Set(args)

const isDryRun = argSet.has('--dry-run')

const parseArgValue = (name, fallback = '') => {
    const prefix = `--${name}=`
    const raw = args.find((entry) => String(entry || '').startsWith(prefix))
    if (!raw) return fallback
    return String(raw.slice(prefix.length) || '').trim()
}

const parsePositiveInt = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 1) return fallback
    return parsed
}

const normalizeRarity = (value) => String(value || '').trim().toLowerCase()

const createSeededRandom = (seedValue = Date.now()) => {
    let state = (Math.abs(Number(seedValue) || 0) + 1) >>> 0
    return () => {
        state = (state + 0x6D2B79F5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const toSeed = (value = '') => {
    const input = String(value || '').trim()
    let hash = 0
    for (let index = 0; index < input.length; index += 1) {
        hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0
    }
    return Math.abs(hash)
}

const resolveTrainerLevel = (trainer = {}) => {
    const milestoneLevel = Math.max(0, Number.parseInt(trainer?.milestoneLevel, 10) || 0)
    const orderLevel = Math.max(0, Number.parseInt(trainer?.orderIndex, 10) || 0)
    return Math.max(milestoneLevel, orderLevel)
}

const resolveAllowedRaritiesByLevel = (level = 1, preset = 'very-hard') => {
    const normalizedLevel = parsePositiveInt(level, 1)

    if (preset === 'hard') {
        if (normalizedLevel >= 1900) return ['sss', 'ss']
        if (normalizedLevel >= 1600) return ['sss', 'ss', 's']
        if (normalizedLevel >= 1200) return ['ss', 's', 'a']
        if (normalizedLevel >= 900) return ['s', 'a', 'b']
        if (normalizedLevel >= 700) return ['a', 'b', 'c']
        if (normalizedLevel >= 500) return ['b', 'c', 'd']
        return ['d']
    }

    if (preset === 'medium') {
        if (normalizedLevel >= 1900) return ['sss', 'ss', 's']
        if (normalizedLevel >= 1500) return ['ss', 's', 'a']
        if (normalizedLevel >= 1200) return ['s', 'a', 'b']
        if (normalizedLevel >= 900) return ['a', 'b', 'c']
        if (normalizedLevel >= 500) return ['b', 'c', 'd']
        return ['d']
    }

    if (normalizedLevel >= 3200) return ['sss']
    if (normalizedLevel >= 2400) return ['sss', 'ss']
    if (normalizedLevel >= 1800) return ['ss', 'sss']
    if (normalizedLevel >= 1400) return ['s', 'ss', 'sss']
    if (normalizedLevel >= 1000) return ['a', 's', 'ss']
    if (normalizedLevel >= 700) return ['a', 'b', 's']
    if (normalizedLevel >= 500) return ['a', 'b', 'c']
    if (normalizedLevel >= 300) return ['b', 'c', 'd']
    if (normalizedLevel >= 120) return ['c', 'd']
    return ['d']
}

const resolveMilestoneRarityPatternByLevel = (level = 1, teamSize = 3) => {
    const normalizedLevel = parsePositiveInt(level, 1)
    const normalizedTeamSize = Math.max(1, parsePositiveInt(teamSize, 3))

    if (normalizedLevel % 500 === 0) {
        return Array.from({ length: normalizedTeamSize }, () => 'sss')
    }

    if (normalizedLevel % 100 === 0) {
        const pattern = ['ss', 'sss', 'ss']
        return Array.from({ length: normalizedTeamSize }, (_, index) => pattern[index % pattern.length])
    }

    return []
}

const resolveDamagePercentByLevel = (level = 1, preset = 'very-hard') => {
    const normalizedLevel = parsePositiveInt(level, 1)

    if (preset === 'hard') {
        if (normalizedLevel >= 1900) return 260
        if (normalizedLevel >= 1600) return 230
        if (normalizedLevel >= 1200) return 200
        if (normalizedLevel >= 900) return 170
        if (normalizedLevel >= 700) return 150
        if (normalizedLevel >= 500) return 130
        return 100
    }

    if (preset === 'medium') {
        if (normalizedLevel >= 1900) return 220
        if (normalizedLevel >= 1500) return 190
        if (normalizedLevel >= 1200) return 170
        if (normalizedLevel >= 900) return 150
        if (normalizedLevel >= 700) return 130
        if (normalizedLevel >= 500) return 120
        return 100
    }

    if (normalizedLevel >= 1900) return 320
    if (normalizedLevel >= 1700) return 280
    if (normalizedLevel >= 1500) return 240
    if (normalizedLevel >= 1200) return 210
    if (normalizedLevel >= 900) return 180
    if (normalizedLevel >= 700) return 160
    if (normalizedLevel >= 500) return 140
    return 100
}

const normalizeFormId = (value = '') => String(value || '').trim().toLowerCase() || 'normal'

const resolveDefaultFormId = (pokemon = {}) => {
    const forms = Array.isArray(pokemon?.forms) ? pokemon.forms : []
    const defaultFormId = normalizeFormId(pokemon?.defaultFormId || 'normal')
    if (forms.length === 0) return defaultFormId
    const hasDefault = forms.some((entry) => normalizeFormId(entry?.formId) === defaultFormId)
    if (hasDefault) return defaultFormId
    return normalizeFormId(forms[0]?.formId || defaultFormId)
}

const pickUniquePokemon = (pool = [], count = 3, random = Math.random) => {
    const nextPool = [...pool]
    const selected = []
    while (nextPool.length > 0 && selected.length < count) {
        const pickIndex = Math.floor(random() * nextPool.length)
        const [picked] = nextPool.splice(pickIndex, 1)
        if (!picked?._id) continue
        selected.push(picked)
    }
    return selected
}

const pickUniquePokemonByRarity = ({
    rarity = '',
    pokemonByRarity = new Map(),
    pickedIds = new Set(),
    random = Math.random,
}) => {
    const bucket = pokemonByRarity.get(normalizeRarity(rarity))
    if (!Array.isArray(bucket) || bucket.length === 0) return null

    const available = bucket.filter((entry) => !pickedIds.has(String(entry?._id || '')))
    if (available.length === 0) return null

    const pickIndex = Math.floor(random() * available.length)
    const picked = available[pickIndex]
    if (!picked?._id) return null
    pickedIds.add(String(picked._id))
    return picked
}

const run = async () => {
    try {
        await connectDB()

        const preset = (() => {
            const raw = parseArgValue('preset', 'very-hard').toLowerCase()
            if (raw === 'medium' || raw === 'hard' || raw === 'very-hard') return raw
            return 'very-hard'
        })()
        const minLevel = parsePositiveInt(parseArgValue('min-level', '500'), 500)

        const [pokemonPool, trainers] = await Promise.all([
            Pokemon.find({}).select('_id rarity forms defaultFormId').lean(),
            BattleTrainer.find({
                autoGenerated: true,
                $or: [
                    { milestoneLevel: { $gte: minLevel } },
                    { orderIndex: { $gte: minLevel } },
                ],
            })
                .select('_id name team orderIndex milestoneLevel')
                .lean(),
        ])

        if (!Array.isArray(pokemonPool) || pokemonPool.length === 0) {
            throw new Error('Pokemon pool is empty')
        }

        const pokemonByRarity = new Map()
        pokemonPool.forEach((pokemon) => {
            const rarity = normalizeRarity(pokemon?.rarity)
            if (!pokemonByRarity.has(rarity)) {
                pokemonByRarity.set(rarity, [])
            }
            pokemonByRarity.get(rarity).push(pokemon)
        })

        const fallbackRarityOrder = ['sss', 'ss', 's', 'a', 'b', 'c', 'd']

        let changedTrainerCount = 0
        let changedSlotCount = 0
        const previewRows = []
        const bulkOps = []

        trainers.forEach((trainer, trainerIndex) => {
            const trainerLevel = resolveTrainerLevel(trainer)
            if (trainerLevel < 1) return

            const currentTeam = Array.isArray(trainer?.team) ? trainer.team : []
            const teamSize = Math.max(1, currentTeam.length || 3)
            const allowedRarities = resolveAllowedRaritiesByLevel(trainerLevel, preset)

            let candidatePool = []
            allowedRarities.forEach((rarity) => {
                const bucket = pokemonByRarity.get(rarity)
                if (Array.isArray(bucket) && bucket.length > 0) {
                    candidatePool.push(...bucket)
                }
            })
            if (candidatePool.length === 0) {
                candidatePool = [...pokemonPool]
            }

            if (candidatePool.length < teamSize) {
                fallbackRarityOrder.forEach((rarity) => {
                    const bucket = pokemonByRarity.get(rarity)
                    if (!Array.isArray(bucket) || bucket.length === 0) return
                    candidatePool.push(...bucket)
                })
            }

            const trainerSeed = toSeed(`${trainer._id}-${trainerLevel}-${trainerIndex}`)
            const random = createSeededRandom(trainerSeed)
            const pickedIds = new Set()
            const milestoneRarityPattern = resolveMilestoneRarityPatternByLevel(trainerLevel, teamSize)
            const selectedPokemon = []

            if (milestoneRarityPattern.length > 0) {
                milestoneRarityPattern.forEach((rarity) => {
                    const picked = pickUniquePokemonByRarity({
                        rarity,
                        pokemonByRarity,
                        pickedIds,
                        random,
                    })
                    if (picked) selectedPokemon.push(picked)
                })
            }

            if (selectedPokemon.length < teamSize) {
                const remaining = teamSize - selectedPokemon.length
                const fillerPokemon = pickUniquePokemon(
                    candidatePool.filter((entry) => !pickedIds.has(String(entry?._id || ''))),
                    remaining,
                    random
                )
                fillerPokemon.forEach((entry) => {
                    if (!entry?._id) return
                    pickedIds.add(String(entry._id))
                    selectedPokemon.push(entry)
                })
            }

            if (selectedPokemon.length === 0) return

            const targetDamagePercent = resolveDamagePercentByLevel(trainerLevel, preset)
            let changedInTrainer = 0

            const nextTeam = Array.from({ length: teamSize }).map((_, slotIndex) => {
                const currentEntry = currentTeam[slotIndex] || {}
                const pickedPokemon = selectedPokemon[slotIndex] || selectedPokemon[slotIndex % selectedPokemon.length]
                const nextPokemonId = String(pickedPokemon?._id || currentEntry?.pokemonId || '').trim()
                const prevPokemonId = String(currentEntry?.pokemonId || '').trim()
                const nextFormId = resolveDefaultFormId(pickedPokemon)
                const prevFormId = normalizeFormId(currentEntry?.formId || 'normal')
                const prevDamagePercent = Math.max(0, Number.parseInt(currentEntry?.damagePercent, 10) || 100)
                const prevLevel = Math.max(1, Number.parseInt(currentEntry?.level, 10) || 1)

                if (
                    prevPokemonId !== nextPokemonId
                    || prevFormId !== nextFormId
                    || prevDamagePercent !== targetDamagePercent
                    || prevLevel !== trainerLevel
                ) {
                    changedInTrainer += 1
                }

                return {
                    ...currentEntry,
                    pokemonId: nextPokemonId,
                    formId: nextFormId,
                    level: trainerLevel,
                    damagePercent: targetDamagePercent,
                }
            })

            if (changedInTrainer === 0) return

            changedTrainerCount += 1
            changedSlotCount += changedInTrainer

            if (previewRows.length < 10) {
                previewRows.push({
                    id: String(trainer?._id || ''),
                    name: String(trainer?.name || '').trim() || 'Trainer',
                    level: trainerLevel,
                    damagePercent: targetDamagePercent,
                    slots: changedInTrainer,
                    allowedRarities: allowedRarities.join(', '),
                })
            }

            bulkOps.push({
                updateOne: {
                    filter: { _id: trainer._id },
                    update: {
                        $set: {
                            team: nextTeam,
                        },
                    },
                },
            })
        })

        console.log('=== Rebalance Auto Trainer Difficulty ===')
        console.log(`Preset: ${preset}`)
        console.log(`Minimum level: ${minLevel}`)
        console.log(`Dry run: ${isDryRun ? 'yes' : 'no'}`)
        console.log(`Matched trainers: ${trainers.length}`)
        console.log(`Trainers to update: ${changedTrainerCount}`)
        console.log(`Team slots to update: ${changedSlotCount}`)

        if (previewRows.length > 0) {
            console.log('Preview (first 10):')
            previewRows.forEach((row, index) => {
                console.log(
                    `${index + 1}. ${row.name} (${row.id}) | Lv ${row.level} | dmg ${row.damagePercent}% | slots ${row.slots} | rarities: ${row.allowedRarities}`
                )
            })
        }

        if (isDryRun || bulkOps.length === 0) {
            console.log(isDryRun ? 'Dry run complete. No data was modified.' : 'No updates needed.')
            return
        }

        const bulkResult = await BattleTrainer.bulkWrite(bulkOps, { ordered: false })
        console.log('Rebalance complete.')
        console.log(`Bulk matched: ${bulkResult.matchedCount || 0}`)
        console.log(`Bulk modified: ${bulkResult.modifiedCount || 0}`)
    } catch (error) {
        console.error('Rebalance failed:', error.message)
        process.exitCode = 1
    } finally {
        await mongoose.disconnect()
    }
}

run()
