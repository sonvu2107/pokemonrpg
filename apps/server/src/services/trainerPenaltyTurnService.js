import Move from '../models/Move.js'
import { calcMaxHp, calcStatsForLevel } from '../utils/gameUtils.js'
import { resolveEffectivePokemonBaseStats, resolvePokemonFormEntry } from '../utils/pokemonFormStats.js'
import { normalizeVolatileState, resolveActionAvailabilityByStatus } from '../battle/battleState.js'
import { syncTrainerSessionActivePlayerToParty } from './trainerBattlePlayerStateService.js'
import {
    appendTurnPhaseEvent,
    appendTurnPhaseLines,
    createTurnTimeline,
    finalizeTurnTimeline,
    flattenTurnPhaseLines,
    resolveTurnActorPhaseKeys,
} from '../battle/turnTimeline.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const clampStatStage = (value) => clamp(Math.floor(Number(value) || 0), -6, 6)
const applyStatStageToValue = (value, stage = 0) => {
    const numericValue = Math.max(1, Number(value) || 1)
    const normalizedStage = clampStatStage(stage)
    const multiplier = normalizedStage >= 0 ? (2 + normalizedStage) / 2 : 2 / (2 - normalizedStage)
    return Math.max(1, Math.floor(numericValue * multiplier))
}
const normalizeTypeToken = (value = '') => String(value || '').trim().toLowerCase()
const normalizeMoveName = (value = '') => String(value || '').trim().toLowerCase()
const normalizeBattleStatus = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (['burn', 'poison', 'paralyze', 'freeze', 'sleep', 'confuse', 'flinch'].includes(normalized)) return normalized
    if (normalized === 'burned') return 'burn'
    if (normalized === 'poisoned' || normalized === 'toxic') return 'poison'
    if (normalized === 'paralysis' || normalized === 'paralyzed') return 'paralyze'
    if (normalized === 'frozen') return 'freeze'
    if (normalized === 'asleep') return 'sleep'
    return ''
}
const normalizeStatusTurns = (value = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.floor(parsed))
}

const formatStatusLabel = (value = '') => {
    const normalized = normalizeBattleStatus(value)
    if (normalized === 'burn') return 'bỏng'
    if (normalized === 'poison') return 'trúng độc'
    if (normalized === 'paralyze') return 'tê liệt'
    if (normalized === 'freeze') return 'đóng băng'
    if (normalized === 'sleep') return 'ngủ'
    if (normalized === 'confuse') return 'rối loạn'
    if (normalized === 'flinch') return 'choáng'
    if (normalized === 'drowsy') return 'buồn ngủ'
    return String(value || '').trim().toLowerCase()
}

const buildBattleActionLog = ({
    actorName = 'Pokemon',
    moveName = 'Chiêu thức',
    didHit = false,
    damage = 0,
    isStatusMove = false,
    effectivenessText = '',
    missReason = 'trượt',
    suffix = '',
} = {}) => {
    const resolvedActorName = String(actorName || 'Pokemon').trim() || 'Pokemon'
    const resolvedMoveName = String(moveName || 'Chiêu thức').trim() || 'Chiêu thức'
    const trimmedSuffix = String(suffix || '').trim()
    if (!didHit) {
        return `${resolvedActorName} dùng ${resolvedMoveName} nhưng ${missReason}.${trimmedSuffix ? ` ${trimmedSuffix}` : ''}`.trim()
    }
    if (isStatusMove) {
        return `${resolvedActorName} dùng ${resolvedMoveName}!${trimmedSuffix ? ` ${trimmedSuffix}` : ''}`.trim()
    }
    return `${resolvedActorName} dùng ${resolvedMoveName}! Gây ${damage} sát thương.${trimmedSuffix ? ` ${trimmedSuffix}` : ''}${effectivenessText ? ` ${effectivenessText}` : ''}`.trim()
}

const TYPE_EFFECTIVENESS_CHART = {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ground: 2, flying: 2, dragon: 2, steel: 0.5, ice: 0.5 },
    fighting: { normal: 2, ice: 2, rock: 2, dark: 2, steel: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, ghost: 0, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, steel: 0.5, dark: 0 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, fairy: 2, steel: 0.5 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
}

const inferMoveType = (name = '') => {
    const normalized = normalizeMoveName(name)
    if (normalized.includes('fire')) return 'fire'
    if (normalized.includes('water')) return 'water'
    if (normalized.includes('grass') || normalized.includes('leaf') || normalized.includes('vine')) return 'grass'
    if (normalized.includes('electric') || normalized.includes('thunder') || normalized.includes('spark')) return 'electric'
    if (normalized.includes('ice') || normalized.includes('frost')) return 'ice'
    if (normalized.includes('dragon')) return 'dragon'
    if (normalized.includes('shadow') || normalized.includes('ghost')) return 'ghost'
    if (normalized.includes('poison') || normalized.includes('toxic')) return 'poison'
    return 'normal'
}

const normalizeTrainerTypes = (types = []) => {
    const list = Array.isArray(types) ? types : []
    return [...new Set(list.map((entry) => normalizeTypeToken(entry)).filter(Boolean))]
}

const getSpecialAttackStat = (stats = {}) => Number(stats?.spatk) || Number(stats?.atk) || 0
const getSpecialDefenseStat = (stats = {}) => Number(stats?.spdef) || Number(stats?.spldef) || Number(stats?.def) || 0

const resolveMoveCategory = (moveDoc, fallbackMove, resolvedPower) => {
    const category = normalizeTypeToken(moveDoc?.category || fallbackMove?.category)
    if (category === 'physical' || category === 'special' || category === 'status') return category
    return resolvedPower > 0 ? 'physical' : 'status'
}

const resolveMoveAccuracy = (moveDoc, fallbackMove) => {
    let accuracy = Number(moveDoc?.accuracy)
    if (!Number.isFinite(accuracy) || accuracy <= 0) accuracy = Number(fallbackMove?.accuracy)
    if (!Number.isFinite(accuracy) || accuracy <= 0) return 100
    return clamp(Math.floor(accuracy), 1, 100)
}

const resolveTypeEffectiveness = (moveType, defenderTypes = []) => {
    const normalizedMoveType = normalizeTypeToken(moveType)
    const chart = TYPE_EFFECTIVENESS_CHART[normalizedMoveType] || {}
    const uniqueDefenderTypes = normalizeTrainerTypes(defenderTypes)
    if (uniqueDefenderTypes.length === 0) return { multiplier: 1, breakdown: [] }
    let multiplier = 1
    const breakdown = uniqueDefenderTypes.map((type) => {
        const perType = Number.isFinite(chart[type]) ? chart[type] : 1
        multiplier *= perType
        return { type, multiplier: perType }
    })
    return { multiplier, breakdown }
}

const resolveEffectivenessText = (multiplier) => {
    if (multiplier === 0) return 'Không có tác dụng.'
    if (multiplier >= 2) return 'Rất hiệu quả!'
    if (multiplier > 1) return 'Hiệu quả.'
    if (multiplier < 1) return 'Không hiệu quả lắm.'
    return ''
}

const calcBattleDamage = ({ attackerLevel, movePower, attackStat, defenseStat, modifier = 1 }) => {
    if (!Number.isFinite(modifier) || modifier <= 0) return 0
    const level = Math.max(1, Number(attackerLevel) || 1)
    const power = Math.max(1, Number(movePower) || 1)
    const atk = Math.max(1, Number(attackStat) || 1)
    const def = Math.max(1, Number(defenseStat) || 1)
    const base = (((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2
    const averageRandomFactor = 0.925
    return Math.max(1, Math.floor(base * modifier * averageRandomFactor))
}

const extractStatusFromEffectSpecs = (effectSpecs = []) => {
    const specs = Array.isArray(effectSpecs) ? effectSpecs : []
    for (const entry of specs) {
        const target = String(entry?.target || '').trim().toLowerCase()
        const trigger = String(entry?.trigger || '').trim().toLowerCase()
        const op = String(entry?.op || '').trim().toLowerCase()
        if ((target === 'opponent' || !target) && (trigger === 'on_hit' || !trigger) && op.includes('status')) {
            const paramsStatus = normalizeBattleStatus(entry?.params?.status)
            if (paramsStatus) return paramsStatus
            const sourceText = normalizeBattleStatus(entry?.sourceText)
            if (sourceText) return sourceText
        }
        if ((target === 'opponent' || !target) && (trigger === 'on_hit' || !trigger) && op === 'set_drowsy') {
            return 'drowsy'
        }
    }
    return ''
}

const buildPlayerBattleStats = (targetPokemon, fallbackMaxHp = 1) => {
    const species = targetPokemon?.pokemonId || {}
    const level = Math.max(1, Number(targetPokemon?.level || 1))
    const formId = String(targetPokemon?.formId || species?.defaultFormId || 'normal').trim().toLowerCase() || 'normal'
    const resolvedForm = resolvePokemonFormEntry(species, formId)
    const baseStats = resolveEffectivePokemonBaseStats({ pokemonLike: species, formId, resolvedForm })
    const scaledStats = calcStatsForLevel(baseStats, level, species?.rarity || 'd')
    const maxHp = Math.max(1, Number(fallbackMaxHp) || calcMaxHp(baseStats?.hp, level, species?.rarity || 'd'))
    return {
        level,
        stats: scaledStats,
        maxHp,
        name: String(targetPokemon?.nickname || species?.name || 'Pokemon').trim() || 'Pokemon',
        types: normalizeTrainerTypes(species?.types),
    }
}

const buildEffectiveBattleStats = ({ stats = {}, statStages = {} } = {}) => {
    return {
        hp: Math.max(1, Math.floor(Number(stats?.hp) || 1)),
        atk: applyStatStageToValue(Number(stats?.atk) || 1, statStages?.atk),
        def: applyStatStageToValue(Number(stats?.def) || 1, statStages?.def),
        spatk: applyStatStageToValue(Number(stats?.spatk) || 1, statStages?.spatk),
        spdef: applyStatStageToValue(Number(stats?.spdef) || Number(stats?.spldef) || 1, statStages?.spdef),
        spd: applyStatStageToValue(Number(stats?.spd) || 1, statStages?.spd),
    }
}

const buildTrainerMoveNames = (trainerSpecies = {}, activeTrainerOpponent = {}) => {
    const unique = []
    const seen = new Set()
    const push = (value = '') => {
        const name = String(value || '').trim()
        const key = normalizeMoveName(name)
        if (!key || seen.has(key)) return
        seen.add(key)
        unique.push(name)
    }

    const storedCounterMoves = Array.isArray(activeTrainerOpponent?.counterMoves) ? activeTrainerOpponent.counterMoves : []
    storedCounterMoves.forEach((entry) => push(entry?.name))

    const level = Math.max(1, Number(activeTrainerOpponent?.level || 1))
    const learnedEntries = (Array.isArray(trainerSpecies?.levelUpMoves) ? trainerSpecies.levelUpMoves : [])
        .filter((entry) => Number.isFinite(entry?.level) && entry.level <= level)
        .sort((a, b) => a.level - b.level)
        .slice(-4)
    learnedEntries.forEach((entry) => push(entry?.moveName || entry?.moveId?.name))
    ;(Array.isArray(trainerSpecies?.initialMoves) ? trainerSpecies.initialMoves : []).forEach((entry) => push(entry))
    if (unique.length === 0) push('Tackle')
    return unique
}

const buildTrainerMovePool = async ({ trainerSpecies, activeTrainerOpponent }) => {
    const moveNames = buildTrainerMoveNames(trainerSpecies, activeTrainerOpponent)
    const moveDocs = await Move.find({
        nameLower: { $in: moveNames.map((entry) => normalizeMoveName(entry)) },
        isActive: true,
    })
        .select('name nameLower type category power accuracy priority pp effectSpecs effects')
        .lean()

    const moveLookup = new Map()
    moveDocs.forEach((doc) => {
        const key = normalizeMoveName(doc?.nameLower || doc?.name)
        if (!key || moveLookup.has(key)) return
        moveLookup.set(key, doc)
    })

    const storedCounterMoves = Array.isArray(activeTrainerOpponent?.counterMoves) ? activeTrainerOpponent.counterMoves : []
    const storedMap = new Map()
    storedCounterMoves.forEach((entry) => {
        const key = normalizeMoveName(entry?.name)
        if (!key || storedMap.has(key)) return
        storedMap.set(key, entry)
    })

    return moveNames.map((moveName) => {
        const moveKey = normalizeMoveName(moveName)
        const doc = moveLookup.get(moveKey)
        const stored = storedMap.get(moveKey)
        const power = Math.max(0, Number(doc?.power || stored?.power || (moveKey === 'struggle' ? 35 : 50)))
        return {
            name: String(doc?.name || moveName).trim(),
            type: normalizeTypeToken(doc?.type || stored?.type || inferMoveType(moveName)) || 'normal',
            category: resolveMoveCategory(doc, stored, power),
            power,
            accuracy: resolveMoveAccuracy(doc, stored),
            priority: Number(doc?.priority || stored?.priority || 0),
            currentPp: Math.max(0, Number(stored?.currentPp ?? stored?.pp ?? doc?.pp ?? 10)),
            maxPp: Math.max(1, Number(stored?.maxPp ?? doc?.pp ?? 10)),
            effectSpecs: Array.isArray(doc?.effectSpecs) ? doc.effectSpecs : [],
            effects: doc?.effects && typeof doc.effects === 'object' ? doc.effects : {},
        }
    })
}

const chooseTrainerMove = ({ movePool, activeTrainerOpponent, playerBattleStats }) => {
    const opponentLevel = Math.max(1, Number(activeTrainerOpponent?.level || 1))
    const opponentTypes = normalizeTrainerTypes(activeTrainerOpponent?.types)
    const opponentStats = activeTrainerOpponent?.baseStats && typeof activeTrainerOpponent.baseStats === 'object' ? activeTrainerOpponent.baseStats : {}
    const physicalAtk = Math.max(1, Number(opponentStats?.atk) || getSpecialAttackStat(opponentStats) || (20 + opponentLevel * 2))
    const specialAtk = Math.max(1, getSpecialAttackStat(opponentStats) || Number(opponentStats?.atk) || (20 + opponentLevel * 2))
    const physicalDef = Math.max(1, Number(playerBattleStats.stats?.def) || getSpecialDefenseStat(playerBattleStats.stats) || (20 + playerBattleStats.level * 2))
    const specialDef = Math.max(1, getSpecialDefenseStat(playerBattleStats.stats) || Number(playerBattleStats.stats?.def) || (20 + playerBattleStats.level * 2))
    const damagePercent = Math.max(0, Number(activeTrainerOpponent?.damagePercent || 100)) / 100

    return (Array.isArray(movePool) ? movePool : [])
        .filter((entry) => Number(entry?.currentPp) > 0)
        .map((entry) => {
            const effectiveness = resolveTypeEffectiveness(entry.type, playerBattleStats.types)
            const stab = opponentTypes.includes(entry.type) ? 1.5 : 1
            const attackStat = entry.category === 'special' ? specialAtk : physicalAtk
            const defenseStat = entry.category === 'special' ? specialDef : physicalDef
            const estimatedDamage = entry.category === 'status'
                ? 0
                : calcBattleDamage({
                    attackerLevel: opponentLevel,
                    movePower: Math.max(1, Number(entry.power || 0)),
                    attackStat,
                    defenseStat,
                    modifier: Math.max(0.6, damagePercent) * stab * effectiveness.multiplier,
                })
            const statusFromEffects = normalizeBattleStatus(entry?.effects?.statusEffect) || extractStatusFromEffectSpecs(entry?.effectSpecs)
            const statusBonus = statusFromEffects && !normalizeBattleStatus(activeTrainerOpponent?.playerStatus) ? 18 : 0
            const score = estimatedDamage + statusBonus + (Number(entry.priority || 0) * 4) + (Number(entry.accuracy || 100) / 100)
            return {
                ...entry,
                estimatedDamage,
                effectiveness,
                stab,
                score,
                statusFromEffects,
            }
        })
        .sort((a, b) => b.score - a.score || b.estimatedDamage - a.estimatedDamage || b.power - a.power)[0]
        || {
            name: 'Counter Strike',
            type: opponentTypes[0] || 'normal',
            category: 'physical',
            power: 50,
            accuracy: 100,
            estimatedDamage: 1,
            effectiveness: { multiplier: 1, breakdown: [] },
            stab: 1,
            statusFromEffects: '',
        }
}

export const applyTrainerPenaltyTurn = async ({
    activeBattleSession,
    activeTrainerOpponent,
    targetPokemon,
    trainerSpecies = null,
    playerCurrentHp,
    playerMaxHp,
    reason = 'action',
} = {}) => {
    if (!activeBattleSession || !activeTrainerOpponent || !targetPokemon) return null

    const turnTimeline = createTurnTimeline({ playerActsFirst: false })
    const opponentPhaseKeys = resolveTurnActorPhaseKeys(turnTimeline, 'opponent')

    const opponentStatusCheck = resolveActionAvailabilityByStatus({
        status: activeTrainerOpponent?.status,
        statusTurns: activeTrainerOpponent?.statusTurns,
        random: Math.random,
    })
    activeTrainerOpponent.status = normalizeBattleStatus(opponentStatusCheck.statusAfterCheck)
    activeTrainerOpponent.statusTurns = normalizeStatusTurns(opponentStatusCheck.statusTurnsAfterCheck)

    const normalizedPlayerMaxHp = Math.max(1, Number(playerMaxHp) || 1)
    const normalizedPlayerCurrentHp = clamp(Math.floor(Number(playerCurrentHp) || 0), 0, normalizedPlayerMaxHp)
    if (normalizedPlayerCurrentHp <= 0) {
        activeBattleSession.playerCurrentHp = 0
        syncTrainerSessionActivePlayerToParty(activeBattleSession)
        await activeBattleSession.save()
        appendTurnPhaseEvent(turnTimeline, {
            phaseKey: 'faint_resolution',
            actor: 'system',
            kind: 'faint',
            line: 'Pokemon của bạn đã kiệt sức.',
            target: 'player',
        })
        const turnPhases = finalizeTurnTimeline(turnTimeline)
        return {
            damage: 0,
            currentHp: 0,
            maxHp: normalizedPlayerMaxHp,
            defeatedPlayer: true,
            move: { name: 'Counter Strike', type: 'normal', category: 'physical' },
            log: 'Pokemon của bạn đã kiệt sức.',
            turnPhases,
            logLines: flattenTurnPhaseLines(turnPhases),
            reason,
            effects: { logs: [] },
            player: {
                status: normalizeBattleStatus(activeBattleSession.playerStatus),
                statusTurns: normalizeStatusTurns(activeBattleSession.playerStatusTurns),
            },
        }
    }

    const playerBattleStats = buildPlayerBattleStats(targetPokemon, normalizedPlayerMaxHp)
    const preActionLogs = (opponentStatusCheck.reason === 'wakeup' || opponentStatusCheck.reason === 'thaw' || opponentStatusCheck.reason === 'confuse_end')
        ? [opponentStatusCheck.log].filter(Boolean)
        : []
    const shouldSkipPenaltyTurnAction = (
        !opponentStatusCheck.canAct
        || opponentStatusCheck.reason === 'wakeup'
        || opponentStatusCheck.reason === 'thaw'
    )
    if (shouldSkipPenaltyTurnAction) {
        syncTrainerSessionActivePlayerToParty(activeBattleSession)
        await activeBattleSession.save()
        appendTurnPhaseLines(turnTimeline, {
            phaseKey: opponentPhaseKeys.preAction,
            actor: 'opponent',
            kind: 'status_check',
            lines: preActionLogs.length > 0 ? preActionLogs : [`${String(activeTrainerOpponent?.name || 'Pokemon đối thủ').trim() || 'Pokemon đối thủ'}: ${opponentStatusCheck.log || 'Không thể hành động.'}`],
            target: 'opponent',
        })
        appendTurnPhaseEvent(turnTimeline, {
            phaseKey: opponentPhaseKeys.action,
            actor: 'opponent',
            kind: 'action_skipped',
            line: '',
            target: 'opponent',
        })
        const turnPhases = finalizeTurnTimeline(turnTimeline)
        return {
            damage: 0,
            currentHp: normalizedPlayerCurrentHp,
            maxHp: normalizedPlayerMaxHp,
            defeatedPlayer: false,
            move: { name: '', type: 'normal', category: 'status', accuracy: 100, effectiveness: 1, stabMultiplier: 1, hit: false },
            log: preActionLogs[0] || `${String(activeTrainerOpponent?.name || 'Pokemon đối thủ').trim() || 'Pokemon đối thủ'}: ${opponentStatusCheck.log || 'Không thể hành động.'}`,
            turnPhases,
            logLines: flattenTurnPhaseLines(turnPhases),
            reason,
            effects: { logs: preActionLogs },
            player: {
                status: normalizeBattleStatus(activeBattleSession.playerStatus),
                statusTurns: normalizeStatusTurns(activeBattleSession.playerStatusTurns),
                effectiveStats: buildEffectiveBattleStats({
                    stats: playerBattleStats.stats,
                    statStages: activeBattleSession.playerStatStages || {},
                }),
            },
            opponent: {
                status: activeTrainerOpponent.status,
                statusTurns: activeTrainerOpponent.statusTurns,
            },
        }
    }

    const movePool = await buildTrainerMovePool({ trainerSpecies, activeTrainerOpponent })
    const selectedMove = chooseTrainerMove({ movePool, activeTrainerOpponent, playerBattleStats })
    const hitRoll = Math.random() * 100
    const didHit = hitRoll <= Math.max(1, Number(selectedMove.accuracy || 100))
    const damage = didHit ? Math.max(1, Math.floor(Number(selectedMove.estimatedDamage || 1))) : 0
    const nextHp = Math.max(0, normalizedPlayerCurrentHp - damage)

    let nextStatus = normalizeBattleStatus(activeBattleSession.playerStatus)
    let nextStatusTurns = normalizeStatusTurns(activeBattleSession.playerStatusTurns)
    let nextPlayerVolatileState = normalizeVolatileState(activeBattleSession.playerVolatileState)
    const effectLogs = []
    if (didHit && !nextStatus && selectedMove.statusFromEffects) {
        if (selectedMove.statusFromEffects === 'drowsy') {
            nextPlayerVolatileState = {
                ...nextPlayerVolatileState,
                drowsyTurns: 2,
            }
            effectLogs.push(`${playerBattleStats.name} bắt đầu buồn ngủ.`)
        } else {
            nextStatus = selectedMove.statusFromEffects
            nextStatusTurns = ['sleep', 'freeze', 'confuse'].includes(nextStatus) ? 2 : 1
            effectLogs.push(`${playerBattleStats.name} bị ${formatStatusLabel(nextStatus)}.`)
        }
    }

    activeBattleSession.playerPokemonId = targetPokemon._id
    activeBattleSession.playerMaxHp = normalizedPlayerMaxHp
    activeBattleSession.playerCurrentHp = nextHp
    activeBattleSession.playerStatus = nextStatus
    activeBattleSession.playerStatusTurns = nextStatusTurns
    activeBattleSession.playerVolatileState = nextPlayerVolatileState
    syncTrainerSessionActivePlayerToParty(activeBattleSession)
    await activeBattleSession.save()

    const effectivenessText = didHit ? resolveEffectivenessText(selectedMove.effectiveness?.multiplier) : ''
    const baseLog = buildBattleActionLog({
        actorName: String(activeTrainerOpponent?.name || 'Pokemon đối thủ').trim() || 'Pokemon đối thủ',
        moveName: selectedMove.name,
        didHit,
        damage,
        isStatusMove: selectedMove.category === 'status',
        effectivenessText,
        suffix: `khi bạn ${reason === 'switch' ? 'đổi Pokemon' : 'dùng vật phẩm'}`,
    })
    appendTurnPhaseLines(turnTimeline, {
        phaseKey: opponentPhaseKeys.preAction,
        actor: 'opponent',
        kind: 'status_check',
        lines: preActionLogs,
        target: 'opponent',
    })
    appendTurnPhaseEvent(turnTimeline, {
        phaseKey: opponentPhaseKeys.action,
        actor: 'opponent',
        kind: 'move_used',
        line: baseLog,
        moveName: selectedMove.name,
        didHit,
        damage,
        target: 'player',
    })
    appendTurnPhaseLines(turnTimeline, {
        phaseKey: opponentPhaseKeys.postAction,
        actor: 'system',
        kind: 'effect_log',
        lines: effectLogs,
        target: 'player',
    })
    if (nextHp <= 0) {
        appendTurnPhaseEvent(turnTimeline, {
            phaseKey: 'faint_resolution',
            actor: 'system',
            kind: 'faint',
            line: `${playerBattleStats.name} đã bại trận.`,
            target: 'player',
        })
    }
    const turnPhases = finalizeTurnTimeline(turnTimeline)

    return {
        damage,
        currentHp: nextHp,
        maxHp: normalizedPlayerMaxHp,
        defeatedPlayer: nextHp <= 0,
        move: {
            name: selectedMove.name,
            type: selectedMove.type,
            category: selectedMove.category,
            power: selectedMove.power,
            accuracy: selectedMove.accuracy,
            effectiveness: selectedMove.effectiveness?.multiplier || 1,
            stabMultiplier: selectedMove.stab || 1,
            hit: didHit,
        },
        log: baseLog,
        turnPhases,
        logLines: flattenTurnPhaseLines(turnPhases),
        reason,
        effects: { logs: [...preActionLogs, ...effectLogs] },
        player: {
            status: nextStatus,
            statusTurns: nextStatusTurns,
            effectiveStats: buildEffectiveBattleStats({
                stats: playerBattleStats.stats,
                statStages: activeBattleSession.playerStatStages || {},
            }),
        },
        opponent: {
            status: activeTrainerOpponent.status,
            statusTurns: activeTrainerOpponent.statusTurns,
        },
    }
}
