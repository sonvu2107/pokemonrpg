import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { gameApi } from '../services/gameApi'
import Modal from '../components/Modal'
import FeatureUnavailableNotice from '../components/FeatureUnavailableNotice'
import { resolvePokemonSprite } from '../utils/pokemonFormUtils'
import { resolveAvatarUrl } from '../utils/avatarUrl'
import { hasVipAutoBattleTrainerAccess } from '../utils/vip'
import { getVipAutoLimitConfig } from '../utils/vipAutoLimits'

const TRAINER_ORDER_STORAGE_KEY = 'battle_trainer_order_index'
const MOBILE_COMPLETED_ENTRIES_PER_VIEW = 4
const DESKTOP_COMPLETED_ENTRIES_PER_VIEW = 6
const TRAINER_ATTACK_SPAM_REPOSITION_THRESHOLD = 24
const TRAINER_ATTACK_REPOSITION_INTERVAL_MS = 10 * 60 * 1000
const TRAINER_ATTACK_ANTI_SPAM_UI_COOLDOWN_MS = 10 * 60 * 1000
const TRAINER_ATTACK_MOBILE_CHALLENGE_THRESHOLD = 8
const AUTO_TRAINER_TARGET_STORAGE_KEY = 'battle_auto_trainer_target_id_v1'
const AUTO_TRAINER_ATTACK_INTERVAL_OPTIONS = [
    { value: 450, label: 'Nhanh (0.45s)' },
    { value: 700, label: 'Vừa (0.7s)' },
    { value: 1000, label: 'Chậm (1.0s)' },
    { value: 1400, label: 'Rất chậm (1.4s)' },
]
const DEFAULT_AUTO_TRAINER_ATTACK_INTERVAL_MS = AUTO_TRAINER_ATTACK_INTERVAL_OPTIONS[1].value
const DEFAULT_RANKED_RETURN_PATH = '/rankings/pokemon'
const ALLOWED_RANKED_RETURN_PATHS = new Set(['/rankings/pokemon', '/rankings/overall', '/rankings/daily', '/stats/online', '/friends'])
const shuffleList = (list = []) => {
    const copied = Array.isArray(list) ? [...list] : []
    for (let index = copied.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
        const tmp = copied[index]
        copied[index] = copied[swapIndex]
        copied[swapIndex] = tmp
    }
    return copied
}
const isMobileClient = () => {
    if (typeof window === 'undefined') return false
    return Number(window.innerWidth || 1024) <= 768
}
const createTrainerAttackChallenge = () => {
    const left = 5 + Math.floor(Math.random() * 20)
    const right = 3 + Math.floor(Math.random() * 15)
    const useAddition = Math.random() < 0.5
    const answer = useAddition ? (left + right) : Math.max(1, left - right)
    const prompt = useAddition
        ? `Mật mã Pokeball: ${left} + ${right} = ?`
        : `Mật mã Pokeball: ${left} - ${right} = ?`
    const wrongCandidates = [
        answer + 1,
        answer + 2,
        Math.max(0, answer - 1),
        Math.max(0, answer - 2),
        answer + 4,
    ].filter((value) => value !== answer)
    const uniqueWrongs = [...new Set(wrongCandidates)].slice(0, 3)
    const options = shuffleList([answer, ...uniqueWrongs])

    return {
        id: Date.now(),
        prompt,
        answer,
        options,
    }
}
const normalizeEntityId = (value = '') => String(value || '').trim()
const clampValue = (value, min, max) => Math.max(min, Math.min(max, value))
const formatFriendlyAutoTrainerMessage = (value = '') => {
    const raw = String(value || '').trim()
    if (!raw) return ''

    let message = raw
        .replace(/TIME_BUDGET/gi, 'hệ thống đang bận theo nhịp xử lý')
        .replace(/REQUEST_TIMEOUT/gi, 'kết nối tạm chậm')
        .replace(/SESSION_CONFLICT/gi, 'phiên chiến đấu đang được đồng bộ')
        .replace(/BATTLE_SESSION_CONFLICT/gi, 'phiên chiến đấu đang được đồng bộ')
        .replace(/ATTACK_ERROR/gi, 'lỗi ra đòn tạm thời')
        .replace(/RESOLVE_ERROR/gi, 'lỗi nhận kết quả tạm thời')
        .replace(/PLAYER_DEFEATED/gi, 'Pokemon của bạn đã kiệt sức')
        .replace(/DAILY_LIMIT_REACHED/gi, 'đã đạt giới hạn hôm nay')
        .replace(/DURATION_EXPIRED/gi, 'đã hết thời lượng hôm nay')

    message = message
        .replace(/Auto battle trainer lỗi tạm thời:/i, 'Auto battle trainer đang xử lý, sẽ tự thử lại:')
        .replace(/Auto battle trainer dung do loi:/i, 'Auto battle trainer tạm dừng do lỗi:')

    return message
}
const readStoredAutoTrainerTargetId = () => {
    if (typeof window === 'undefined') return ''
    try {
        return normalizeEntityId(window.localStorage.getItem(AUTO_TRAINER_TARGET_STORAGE_KEY))
    } catch {
        return ''
    }
}
const writeStoredAutoTrainerTargetId = (value = '') => {
    if (typeof window === 'undefined') return
    const normalized = normalizeEntityId(value)
    try {
        if (!normalized) {
            window.localStorage.removeItem(AUTO_TRAINER_TARGET_STORAGE_KEY)
            return
        }
        window.localStorage.setItem(AUTO_TRAINER_TARGET_STORAGE_KEY, normalized)
    } catch {
        // ignore storage error
    }
}
const buildAutoTrainerConfigSnapshot = ({ enabled, trainerId, attackIntervalMs }) => {
    return JSON.stringify({
        enabled: Boolean(enabled),
        trainerId: normalizeEntityId(trainerId),
        attackIntervalMs: Math.max(450, Number(attackIntervalMs) || DEFAULT_AUTO_TRAINER_ATTACK_INTERVAL_MS),
    })
}
const expToNextPokemonLevel = (level = 1) => 250 + Math.max(0, Number(level || 1) - 1) * 100
const hydratePartyWithBattleHp = (partySlots = []) => {
    return (Array.isArray(partySlots) ? partySlots : []).map((slot) => {
        if (!slot) return slot
        const maxHp = Math.max(1, Number(slot?.stats?.hp) || 1)
        return {
            ...slot,
            battleCurrentHp: maxHp,
            battleMaxHp: maxHp,
        }
    })
}
const resolveSafeRankedReturnPath = (value = '') => {
    const normalizedRaw = String(value || '').trim()
    if (!normalizedRaw) return DEFAULT_RANKED_RETURN_PATH
    const normalized = `/${normalizedRaw.replace(/^\/+/, '')}`
    if (ALLOWED_RANKED_RETURN_PATHS.has(normalized)) return normalized
    return DEFAULT_RANKED_RETURN_PATH
}
const resolveDuelReturnLabel = (value = '') => {
    if (value === '/stats/online') return 'Quay về danh sách online'
    if (value === '/friends') return 'Quay về Bạn bè'
    if (value === '/rankings/overall') return 'Quay về BXH chung'
    if (value === '/rankings/daily') return 'Quay về BXH hằng ngày'
    return 'Quay về BXH Pokemon'
}
const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-400 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm first:rounded-t">
        {title}
    </div>
)
const typeColors = {
    grass: 'bg-green-100 text-green-800 border-green-300',
    fire: 'bg-red-100 text-red-800 border-red-300',
    water: 'bg-blue-100 text-blue-800 border-blue-300',
    electric: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    ice: 'bg-cyan-100 text-cyan-800 border-cyan-300',
    dragon: 'bg-indigo-100 text-indigo-800 border-indigo-300',
    poison: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300',
    normal: 'bg-slate-100 text-slate-800 border-slate-300',
    bug: 'bg-lime-100 text-lime-800 border-lime-300',
    dark: 'bg-stone-200 text-stone-800 border-stone-400',
    fairy: 'bg-pink-100 text-pink-800 border-pink-300',
    fighting: 'bg-orange-100 text-orange-800 border-orange-300',
    flying: 'bg-sky-100 text-sky-800 border-sky-300',
    ghost: 'bg-violet-100 text-violet-800 border-violet-300',
    ground: 'bg-amber-100 text-amber-800 border-amber-300',
    psychic: 'bg-rose-100 text-rose-800 border-rose-300',
    rock: 'bg-yellow-200 text-yellow-900 border-yellow-400',
    steel: 'bg-zinc-100 text-zinc-800 border-zinc-300',
}
const normalizeTypeValue = (value = '') => String(value || '').trim().toLowerCase()
const resolvePokemonTypes = (rawTypes = []) => {
    const list = Array.isArray(rawTypes) ? rawTypes : []
    return [...new Set(
        list
            .map((entry) => {
                if (typeof entry === 'string') return normalizeTypeValue(entry)
                if (!entry || typeof entry !== 'object') return ''
                if (typeof entry.type === 'string') return normalizeTypeValue(entry.type)
                if (typeof entry.name === 'string') return normalizeTypeValue(entry.name)
                if (entry.type && typeof entry.type === 'object') return normalizeTypeValue(entry.type.name)
                return ''
            })
            .filter(Boolean)
    )]
}
const PokemonTypeBadges = ({ types = [] }) => {
    const normalizedTypes = resolvePokemonTypes(types)
    if (normalizedTypes.length === 0) {
        return <div className="mb-1 text-[10px] font-bold text-slate-400">Hệ: --</div>
    }
    return (
        <div className="mb-1 flex flex-wrap justify-center gap-1">
            {normalizedTypes.map((type) => (
                <span
                    key={type}
                    className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase ${typeColors[type] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
                >
                    {type}
                </span>
            ))}
        </div>
    )
}
const statusLabels = {
    burn: 'Bỏng',
    poison: 'Độc',
    paralyze: 'Tê Liệt',
    freeze: 'Đóng Băng',
    sleep: 'Ngủ',
    confuse: 'Rối Loạn',
    flinch: 'Choáng',
}
const getGuardBadgeText = (guards = {}) => {
    const normalized = guards && typeof guards === 'object' ? guards : {}
    const physicalTurns = Number(normalized?.physical?.turns || 0)
    const specialTurns = Number(normalized?.special?.turns || 0)
    if (physicalTurns > 0 && specialTurns > 0) {
        return `Lá chắn hỗn hợp (${Math.max(physicalTurns, specialTurns)})`
    }
    if (physicalTurns > 0) {
        return `Chắn vật lý (${physicalTurns})`
    }
    if (specialTurns > 0) {
        return `Chắn đặc biệt (${specialTurns})`
    }
    return ''
}
const getVolatileBadgeText = (volatileState = {}) => {
    const state = volatileState && typeof volatileState === 'object' ? volatileState : {}
    const statusShieldTurns = Number(state?.statusShieldTurns || 0)
    if (statusShieldTurns > 0) {
        return `Chắn trạng thái (${statusShieldTurns})`
    }
    const statDropShieldTurns = Number(state?.statDropShieldTurns || 0)
    if (statDropShieldTurns > 0) {
        return `Chắn giảm chỉ số (${statDropShieldTurns})`
    }
    const rechargeTurns = Number(state?.rechargeTurns || 0)
    if (rechargeTurns > 0) {
        return `Hồi sức (${rechargeTurns})`
    }
    const bindTurns = Number(state?.bindTurns || 0)
    if (bindTurns > 0) {
        return `Bị trói (${bindTurns})`
    }
    const lockedRepeatMoveName = String(state?.lockedRepeatMoveName || '').trim()
    if (lockedRepeatMoveName) {
        return `Không lặp: ${lockedRepeatMoveName}`
    }
    return ''
}
const normalizeMoveType = (name = '') => {
    const normalized = String(name || '').toLowerCase()
    if (normalized.includes('fire')) return 'fire'
    if (normalized.includes('water')) return 'water'
    if (normalized.includes('grass') || normalized.includes('leaf') || normalized.includes('vine')) return 'grass'
    if (normalized.includes('electric') || normalized.includes('spark') || normalized.includes('thunder')) return 'electric'
    if (normalized.includes('ice') || normalized.includes('frost')) return 'ice'
    if (normalized.includes('dragon')) return 'dragon'
    if (normalized.includes('poison') || normalized.includes('toxic')) return 'poison'
    return 'normal'
}
const resolveMovePowerForDisplay = (entry, name = '') => {
    const powerRaw = Number(entry?.power)
    if (Number.isFinite(powerRaw) && powerRaw > 0) {
        return Math.floor(powerRaw)
    }
    return normalizeMoveNameKey(name) === 'struggle' ? 35 : 0
}
const normalizeMoveNameKey = (value = '') => String(value || '').trim().toLowerCase()
const getBattlePokemonDisplayName = (pokemon) => pokemon?.nickname || pokemon?.pokemonId?.name || 'Pokemon'
const mergeBattleMoveNames = (moves = []) => {
    const explicit = (Array.isArray(moves) ? moves : [])
        .map((entry) => {
            if (typeof entry === 'string') {
                const name = String(entry || '').trim()
                return name ? { name } : null
            }

            const name = String(entry?.name || entry?.moveName || '').trim()
            if (!name) return null

            return {
                ...entry,
                name,
            }
        })
        .filter(Boolean)

    return explicit.slice(0, 4)
}
const normalizeMoveList = (moves = []) => {
    const struggleMove = {
        id: 'struggle-fallback',
        name: 'Struggle',
        type: 'normal',
        power: 35,
        category: 'physical',
        currentPp: 99,
        maxPp: 99,
    }
    const list = Array.isArray(moves) ? moves : []
    const mapped = list
        .map((entry, index) => {
            const name = typeof entry === 'string'
                ? entry
                : String(entry?.name || entry?.moveName || '').trim()
            if (!name) return null
            const type = String(entry?.type || '').trim().toLowerCase() || normalizeMoveType(name)
            const power = resolveMovePowerForDisplay(entry, name)
            const currentPpRaw = Number(entry?.currentPp ?? entry?.pp)
            const maxPpRaw = Number(entry?.maxPp)
            const defaultPp = Math.max(1, Math.floor(Number(entry?.pp) || 10))
            const maxPp = Number.isFinite(maxPpRaw) && maxPpRaw > 0 ? Math.floor(maxPpRaw) : defaultPp
            const currentPp = Number.isFinite(currentPpRaw)
                ? Math.max(0, Math.min(maxPp, Math.floor(currentPpRaw)))
                : maxPp
            return {
                id: `${name}-${index}`,
                name,
                type,
                power,
                category: String(entry?.category || '').trim().toLowerCase(),
                accuracy: Number.isFinite(Number(entry?.accuracy)) ? Math.max(1, Math.floor(Number(entry.accuracy))) : 100,
                priority: Number.isFinite(Number(entry?.priority)) ? Math.floor(Number(entry.priority)) : 0,
                currentPp,
                maxPp,
            }
        })
        .filter(Boolean)

    if (mapped.length > 0) {
        const limited = mapped.slice(0, 4)
        const hasStruggle = limited.some((entry) => normalizeMoveNameKey(entry?.name) === 'struggle')
        return hasStruggle ? limited : [...limited, struggleMove]
    }

    return [struggleMove]
}

const moveTypeAdvantageHints = {
    fire: { strong: ['grass', 'ice'], weak: ['water', 'fire'] },
    water: { strong: ['fire', 'rock'], weak: ['grass', 'water', 'electric'] },
    grass: { strong: ['water', 'rock', 'ground'], weak: ['fire', 'grass', 'poison', 'flying', 'bug', 'dragon'] },
    electric: { strong: ['water', 'flying'], weak: ['grass', 'electric', 'dragon', 'ground'] },
    ice: { strong: ['grass', 'dragon', 'flying', 'ground'], weak: ['fire', 'water', 'ice'] },
    poison: { strong: ['grass', 'fairy'], weak: ['poison', 'ground', 'rock', 'ghost'] },
    dragon: { strong: ['dragon'], weak: ['steel', 'fairy'] },
    normal: { strong: [], weak: ['rock', 'steel', 'ghost'] },
}

const resolveMoveEffectivenessHint = (moveType = 'normal', targetTypes = []) => {
    const normalizedMoveType = String(moveType || 'normal').trim().toLowerCase() || 'normal'
    const normalizedTargetTypes = [...new Set(
        (Array.isArray(targetTypes) ? targetTypes : [])
            .map((entry) => String(entry || '').trim().toLowerCase())
            .filter(Boolean)
    )]
    if (normalizedTargetTypes.length === 0) return 1

    const chartEntry = moveTypeAdvantageHints[normalizedMoveType] || { strong: [], weak: [] }
    let multiplier = 1
    normalizedTargetTypes.forEach((targetType) => {
        if (chartEntry.strong.includes(targetType)) {
            multiplier *= 1.6
            return
        }
        if (chartEntry.weak.includes(targetType)) {
            multiplier *= 0.65
        }
    })
    return Math.max(0.2, Math.min(2.56, multiplier))
}

const buildBattlePlans = ({ moves = [], playerTypes = [], targetTypes = [] } = {}) => {
    const normalizedMoves = Array.isArray(moves) ? moves : []
    const availableMoves = normalizedMoves
        .map((entry, index) => ({ ...entry, index }))
        .filter((entry) => Number(entry?.currentPp) > 0)

    if (availableMoves.length === 0) return []

    const normalizedPlayerTypes = [...new Set(
        (Array.isArray(playerTypes) ? playerTypes : [])
            .map((entry) => String(entry || '').trim().toLowerCase())
            .filter(Boolean)
    )]

    const buildScore = (entry, profile = 'balanced') => {
        const power = Math.max(1, Number(entry?.power) || 1)
        const accuracy = Math.max(0.35, Math.min(1, (Number(entry?.accuracy) || 100) / 100))
        const priority = Number(entry?.priority) || 0
        const pp = Math.max(1, Number(entry?.currentPp) || 1)
        const effectiveness = resolveMoveEffectivenessHint(entry?.type, targetTypes)
        const stab = normalizedPlayerTypes.includes(String(entry?.type || '').trim().toLowerCase()) ? 1.25 : 1

        if (profile === 'finisher') {
            return (power * effectiveness * stab * 1.2) + (priority * 10) + (accuracy * 35)
        }

        if (profile === 'safe') {
            return (accuracy * 140) + (effectiveness * 38) + (stab * 24) + (priority * 14) + Math.min(18, pp)
        }

        return (power * effectiveness * stab) + (accuracy * 28) + (priority * 8) + Math.min(12, pp)
    }

    const pickBestMove = (profile) => {
        let best = availableMoves[0]
        let bestScore = Number.NEGATIVE_INFINITY
        for (const entry of availableMoves) {
            const score = buildScore(entry, profile)
            if (score > bestScore) {
                bestScore = score
                best = entry
            }
        }
        return { move: best, score: bestScore }
    }

    const finisher = pickBestMove('finisher')
    const safe = pickBestMove('safe')
    const balanced = pickBestMove('balanced')

    return [
        {
            key: 'finisher',
            title: 'Kết liễu',
            description: 'Ưu tiên đòn mạnh, hiệu quả hệ và có lợi thế ra đòn.',
            move: finisher.move,
            score: finisher.score,
        },
        {
            key: 'safe',
            title: 'An toàn',
            description: 'Ưu tiên độ chính xác cao, giảm rủi ro trượt chiêu.',
            move: safe.move,
            score: safe.score,
        },
        {
            key: 'balanced',
            title: 'Cân bằng',
            description: 'Kết hợp sát thương, PP và tính ổn định tổng thể.',
            move: balanced.move,
            score: balanced.score,
        },
    ]
}

const buildRefilledBattleMoves = (pokemonSlot = null) => {
    const mergedMoves = mergeBattleMoveNames(pokemonSlot?.moves || [])

    const refilledMoves = normalizeMoveList(mergedMoves)
        .filter((entry) => normalizeMoveNameKey(entry?.name) !== 'struggle')
        .slice(0, 4)
        .map((entry) => ({
            ...entry,
            currentPp: Math.max(1, Number(entry?.maxPp) || 1),
            pp: Math.max(1, Number(entry?.maxPp) || 1),
        }))

    const movePpState = refilledMoves.map((entry) => ({
        moveName: String(entry?.name || '').trim(),
        currentPp: Math.max(1, Number(entry?.maxPp) || 1),
        maxPp: Math.max(1, Number(entry?.maxPp) || 1),
    }))

    return {
        moves: refilledMoves,
        movePpState,
    }
}
const ProgressBar = ({ current, max, colorClass, label }) => {
    const safeMax = max > 0 ? max : 1
    const percent = Math.min(100, Math.max(0, (current / safeMax) * 100))
    return (
        <div className="w-full">
            <div className="flex justify-between text-[10px] font-bold px-1 mb-0.5">
                <span>{label}: {Math.round(percent)}%</span>
                <span>{Math.max(0, Math.floor(current))}/{Math.max(1, Math.floor(safeMax))}</span>
            </div>
            <div className="h-2 w-full bg-slate-200 rounded-full border border-slate-300 overflow-hidden">
                <div
                    className={`h-full ${colorClass} transition-all duration-300`}
                    style={{ width: `${percent}%` }}
                />
            </div>
        </div>
    )
}
const ActiveBattleView = ({
    party,
    encounter,
    playerState,
    opponent,
    onAttack,
    actionMessage,
    activeTab,
    onSelectTab,
    inventory,
    onUseItem,
    onRun,
    selectedMoveIndex,
    onSelectMove,
    onPlanMove,
    onSwitchParty,
    battleLog,
    isAttacking,
    activePartyIndex,
    partyHpState,
    allowAttackSpamClicks,
    attackButtonOffset,
}) => {
    const resolvedActiveIndex = Number.isInteger(activePartyIndex)
        ? activePartyIndex
        : party.findIndex((slot) => Boolean(slot))
    const activePokemon = party[resolvedActiveIndex] || party.find((slot) => Boolean(slot)) || null
    const activeHpState = (resolvedActiveIndex >= 0 && Array.isArray(partyHpState))
        ? partyHpState[resolvedActiveIndex]
        : null
    const activeMaxHp = Math.max(
        1,
        Number(activeHpState?.maxHp)
        || Number(activePokemon?.battleMaxHp)
        || Number(activePokemon?.stats?.hp)
        || 100
    )
    const activeCurrentHpRaw = Number(activeHpState?.currentHp)
    const activeCurrentHp = Number.isFinite(activeCurrentHpRaw)
        ? activeCurrentHpRaw
        : (Number.isFinite(Number(activePokemon?.battleCurrentHp))
            ? Number(activePokemon?.battleCurrentHp)
            : activeMaxHp)

    const playerMon = activePokemon ? {
        name: activePokemon.nickname || activePokemon.pokemonId?.name || 'Unknown',
        level: activePokemon.level,
        types: resolvePokemonTypes(activePokemon?.pokemonId?.types),
        maxHp: activeMaxHp,
        hp: Math.max(0, Math.min(activeMaxHp, activeCurrentHp)),
        exp: activePokemon.experience,
        maxExp: expToNextPokemonLevel(activePokemon.level),
        sprite: resolvePokemonSprite({
            species: activePokemon.pokemonId || {},
            formId: activePokemon.formId,
            isShiny: Boolean(activePokemon.isShiny),
            preferBack: true,
        }),
        status: String(activePokemon?.status || '').trim().toLowerCase(),
        statusTurns: Number.isFinite(Number(activePokemon?.statusTurns)) ? Math.max(0, Math.floor(Number(activePokemon.statusTurns))) : 0,
        damageGuards: activePokemon?.damageGuards || {},
        volatileState: activePokemon?.volatileState || {},
        moves: normalizeMoveList(mergeBattleMoveNames(activePokemon.moves || [])),
    } : null

    const activeOpponent = opponent?.team?.[opponent.currentIndex || 0] || null
    const activeOpponentTypes = resolvePokemonTypes(
        Array.isArray(activeOpponent?.types)
            ? activeOpponent.types
            : (Array.isArray(activeOpponent?.pokemon?.types) ? activeOpponent.pokemon.types : [])
    )
    const enemyMon = activeOpponent ? {
        name: activeOpponent.name || 'Pokemon Hoang Dã',
        owner: opponent?.trainerName || 'Hoang Dã',
        level: activeOpponent.level,
        types: activeOpponentTypes,
        maxHp: activeOpponent.maxHp || activeOpponent.baseStats?.hp || 1,
        hp: activeOpponent.currentHp ?? (activeOpponent.maxHp || activeOpponent.baseStats?.hp || 1),
        sprite: activeOpponent.sprite || '',
        status: String(activeOpponent?.status || '').trim().toLowerCase(),
        statusTurns: Number.isFinite(Number(activeOpponent?.statusTurns)) ? Math.max(0, Math.floor(Number(activeOpponent.statusTurns))) : 0,
        damageGuards: activeOpponent?.damageGuards || {},
        volatileState: activeOpponent?.volatileState || {},
    } : {
        name: 'Pokemon Hoang Dã',
        owner: 'Hoang Dã',
        level: 1,
        maxHp: 1,
        hp: 1,
        sprite: '',
        status: '',
        statusTurns: 0,
        types: [],
        damageGuards: {},
        volatileState: {},
    }

    const moves = playerMon?.moves || normalizeMoveList([])
    const selectedMove = moves[selectedMoveIndex] || moves[0] || normalizeMoveList([])[0]
    const playerTypes = playerMon?.types || []
    const enemyTypes = enemyMon?.types || []
    const planOptions = buildBattlePlans({
        moves,
        playerTypes,
        targetTypes: enemyTypes,
    })
    const partySwitchOptions = (Array.isArray(party) ? party : []).map((slot, index) => {
        if (!slot) return null
        const hpEntry = Array.isArray(partyHpState) ? partyHpState[index] : null
        const maxHp = Math.max(
            1,
            Number(hpEntry?.maxHp)
            || Number(slot?.battleMaxHp)
            || Number(slot?.stats?.hp)
            || 1
        )
        const currentHp = clampValue(
            Number.isFinite(Number(hpEntry?.currentHp))
                ? Number(hpEntry.currentHp)
                : (Number.isFinite(Number(slot?.battleCurrentHp)) ? Number(slot.battleCurrentHp) : maxHp),
            0,
            maxHp
        )
        return {
            index,
            slot,
            maxHp,
            currentHp,
            isFainted: currentHp <= 0,
            isActive: index === resolvedActiveIndex,
        }
    }).filter(Boolean)
    const battleUsableInventory = (Array.isArray(inventory) ? inventory : [])
        .filter((entry) => {
            const itemType = String(entry?.item?.type || '').trim().toLowerCase()
            if (!entry?.item?._id || Number(entry?.quantity) <= 0) return false
            return itemType === 'healing'
        })
    const safeAttackButtonOffset = (attackButtonOffset && typeof attackButtonOffset === 'object')
        ? attackButtonOffset
        : { x: 0, y: 0 }
    const attackButtonStyle = allowAttackSpamClicks
        ? {
            transform: `translate(${safeAttackButtonOffset.x}px, ${safeAttackButtonOffset.y}px)`,
            position: 'relative',
            zIndex: 40,
        }
        : undefined

    return (
        <div className="space-y-3 animate-fadeIn">
            <div className="grid grid-cols-2 gap-1 bg-white border border-slate-400 p-1 rounded">
                <div className="border-2 border-double border-slate-300 rounded p-2 bg-white flex flex-col items-center">
                    <h3 className="font-bold text-sm mb-1">
                        {playerMon ? `Của bạn: ${playerMon.name}` : 'Không có Pokemon trong đội'}
                    </h3>
                    {playerMon && <PokemonTypeBadges types={playerMon.types} />}
                    {playerMon?.status && (
                        <div className="mb-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-0.5">
                            {statusLabels[playerMon.status] || playerMon.status}
                            {playerMon.statusTurns > 0 ? ` (${playerMon.statusTurns})` : ''}
                        </div>
                    )}
                    {playerMon && getGuardBadgeText(playerMon.damageGuards) && (
                        <div className="mb-1 text-[10px] font-bold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-0.5">
                            {getGuardBadgeText(playerMon.damageGuards)}
                        </div>
                    )}
                    {playerMon && getVolatileBadgeText(playerMon.volatileState) && (
                        <div className="mb-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            {getVolatileBadgeText(playerMon.volatileState)}
                        </div>
                    )}

                    {playerMon && (
                        <div className="w-full grid grid-cols-2 gap-1 mb-2">
                            <ProgressBar current={playerMon.hp} max={playerMon.maxHp} colorClass="bg-green-500" label="HP" />
                        </div>
                    )}

                    {playerMon && (
                        <div className="w-full mb-4">
                            <div className="text-[10px] font-bold text-center mb-0.5">Cấp {playerMon.level}</div>
                            <div className="h-1.5 w-full bg-slate-200 border border-slate-300">
                                <div className="h-full bg-yellow-400" style={{ width: `${(playerMon.exp / playerMon.maxExp) * 100}%` }}></div>
                            </div>
                        </div>
                    )}

                    {playerMon?.sprite ? (
                        <img src={playerMon.sprite} className="w-24 h-24 pixelated object-contain" />
                    ) : (
                        <div className="w-24 h-24 bg-slate-100 border border-slate-200 rounded" />
                    )}
                </div>

                <div className="border-2 border-double border-slate-300 rounded p-2 bg-white flex flex-col items-center">
                    <h3 className="font-bold text-sm mb-1">{enemyMon.owner} - {enemyMon.name}</h3>
                    <PokemonTypeBadges types={enemyMon.types} />
                    {enemyMon.status && (
                        <div className="mb-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-0.5">
                            {statusLabels[enemyMon.status] || enemyMon.status}
                            {enemyMon.statusTurns > 0 ? ` (${enemyMon.statusTurns})` : ''}
                        </div>
                    )}
                    {getGuardBadgeText(enemyMon.damageGuards) && (
                        <div className="mb-1 text-[10px] font-bold text-cyan-700 bg-cyan-50 border border-cyan-200 rounded px-2 py-0.5">
                            {getGuardBadgeText(enemyMon.damageGuards)}
                        </div>
                    )}
                    {getVolatileBadgeText(enemyMon.volatileState) && (
                        <div className="mb-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                            {getVolatileBadgeText(enemyMon.volatileState)}
                        </div>
                    )}

                    {enemyMon.sprite ? (
                        <img src={enemyMon.sprite} className="w-24 h-24 pixelated object-contain mb-2" />
                    ) : (
                        <div className="w-24 h-24 bg-slate-100 border border-slate-200 rounded mb-2" />
                    )}

                    <div className="w-full mt-auto">
                        <div className="text-[10px] font-bold text-center mb-0.5">Cấp {enemyMon.level}</div>
                        <div className="h-1.5 w-full bg-slate-200 border border-slate-300 mb-2"></div>

                        <div className="w-full grid grid-cols-2 gap-1">
                            <ProgressBar current={enemyMon.hp} max={enemyMon.maxHp} colorClass="bg-green-500" label="HP" />
                        </div>
                    </div>
                </div>
            </div>

            <div className={`border border-slate-400 bg-white rounded ${allowAttackSpamClicks ? 'overflow-visible' : 'overflow-hidden'}`}>
                <div className="flex border-b border-slate-300 text-xs font-bold bg-slate-50">
                    <button
                        onClick={() => onSelectTab('fight')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'fight' ? 'text-green-700 border-b-2 border-green-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Chiến Đấu
                    </button>
                    <button
                        onClick={() => onSelectTab('item')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'item' ? 'text-blue-700 border-b-2 border-blue-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Vật Phẩm
                    </button>
                    <button
                        onClick={() => onSelectTab('focus')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'focus' ? 'text-blue-700 border-b-2 border-blue-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Lên Kế Hoạch
                    </button>
                    <button
                        onClick={() => onSelectTab('party')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'party' ? 'text-blue-700 border-b-2 border-blue-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Đổi Đội Hình
                    </button>
                    <button
                        onClick={() => onSelectTab('run')}
                        className={`flex-1 py-1 px-2 ${activeTab === 'run' ? 'text-red-700 border-b-2 border-red-500 bg-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        Thoát
                    </button>
                </div>

                {activeTab === 'fight' && (moves.length > 0 ? (
                    <div className="p-2 grid grid-cols-2 gap-2">
                        {moves.map((move, idx) => {
                            const isSelected = selectedMoveIndex === idx
                            const isOutOfPp = Number(move.currentPp) <= 0
                            return (
                                <button
                                    key={move.id}
                                    onClick={() => onSelectMove?.(idx)}
                                    className={`text-left p-1 border rounded flex justify-between items-center ${isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-300' : 'border-slate-200 hover:bg-slate-50'} ${isOutOfPp ? 'opacity-70' : ''}`}
                                >
                                    <div>
                                        <span className={`text-[9px] uppercase font-bold px-1 rounded mr-1 ${typeColors[move.type] || 'bg-slate-100'}`}>
                                            {move.type}
                                        </span>
                                        <span className="text-xs font-bold text-slate-800">{move.name}</span>
                                        <div className={`text-[10px] mt-0.5 ${isOutOfPp ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                                            {move.currentPp}/{move.maxPp} PP
                                        </div>
                                    </div>
                                    <div className="text-[11px] font-bold text-right leading-tight">
                                        <div className="text-slate-500 uppercase">Pow</div>
                                        <div>{Number(move.power) > 0 ? move.power : '--'}</div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                ) : (
                    <div className="p-3 text-center text-xs text-slate-500">Không có chiêu thức.</div>
                ))}

                {activeTab === 'item' && (
                    <div className="p-3 text-xs text-slate-600">
                        {battleUsableInventory.length === 0 ? (
                            <div className="text-center text-slate-500">
                                Không có vật phẩm hồi phục có thể dùng trong trận này.
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2">
                                {battleUsableInventory.map((entry) => (
                                    <button
                                        key={entry.item._id}
                                        onClick={() => onUseItem?.(entry)}
                                        className="border border-slate-200 rounded p-2 text-left hover:bg-slate-50"
                                    >
                                        <div className="font-bold text-slate-700">{entry.item.name}</div>
                                        <div className="text-[10px] text-slate-500">x{entry.quantity}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'focus' && (
                    <div className="p-3 space-y-2">
                        {planOptions.length === 0 ? (
                            <div className="text-center text-xs text-slate-500">Không có chiêu còn PP để lên kế hoạch.</div>
                        ) : (
                            planOptions.map((plan) => {
                                const move = plan.move
                                const isSelectedPlan = selectedMoveIndex === move?.index
                                return (
                                    <div
                                        key={plan.key}
                                        className={`border rounded p-2 ${isSelectedPlan ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white'}`}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div>
                                                <div className="text-xs font-bold text-slate-800">{plan.title}</div>
                                                <div className="text-[10px] text-slate-500">{plan.description}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-[10px] font-bold text-slate-500 uppercase">Chiêu</div>
                                                <div className="text-xs font-bold text-slate-800">{move?.name || 'N/A'}</div>
                                            </div>
                                        </div>
                                        <div className="mt-2 flex gap-2">
                                            <button
                                                onClick={() => onPlanMove?.(move?.index, `${plan.title}: ưu tiên ${move?.name || 'chiêu hiện tại'}.`)}
                                                disabled={isAttacking || !Number.isInteger(move?.index)}
                                                className="flex-1 px-2 py-1 border border-blue-300 rounded text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                                            >
                                                Áp dụng kế hoạch
                                            </button>
                                            <button
                                                onClick={() => move && onAttack?.(move)}
                                                disabled={isAttacking || !move}
                                                className="flex-1 px-2 py-1 border border-emerald-300 rounded text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                            >
                                                Đánh theo kế hoạch
                                            </button>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                )}

                {activeTab === 'party' && (
                    <div className="p-3">
                        <div className="grid grid-cols-2 gap-2">
                            {partySwitchOptions.map((entry) => {
                                const slotName = getBattlePokemonDisplayName(entry.slot)
                                return (
                                    <button
                                        key={`${entry.slot?._id || slotName}-${entry.index}`}
                                        onClick={() => onSwitchParty?.(entry.index)}
                                        disabled={isAttacking || entry.isFainted || entry.isActive}
                                        className={`border rounded p-2 text-left ${entry.isActive ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'} disabled:opacity-50`}
                                    >
                                        <div className="text-xs font-bold text-slate-800">{slotName}</div>
                                        <div className="text-[10px] text-slate-500">Lv.{entry.slot?.level || 1}</div>
                                        <div className="text-[10px] mt-1 text-slate-600">
                                            HP {Math.floor(entry.currentHp)}/{Math.floor(entry.maxHp)}
                                        </div>
                                        <div className="text-[10px] mt-1 font-bold">
                                            {entry.isActive
                                                ? 'Đang chiến đấu'
                                                : (entry.isFainted ? 'Đã kiệt sức' : 'Đổi vào sân')}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                {activeTab === 'run' && (
                    <div className="p-3 text-center">
                        <button
                            onClick={onRun}
                            className="px-4 py-2 bg-white border border-slate-300 rounded text-sm font-bold text-slate-700"
                        >
                            Thoát
                        </button>
                    </div>
                )}

                {activeTab === 'fight' && (
                    <div className="p-2 text-center border-t border-slate-200 bg-slate-50">
                        <div className="text-xs text-slate-500 mb-2">
                            Chọn chiêu thức hoặc hành động, sau đó nhấn dưới đây.
                        </div>
                        <button
                            onClick={() => onAttack?.(selectedMove)}
                            disabled={!playerMon || (isAttacking && !allowAttackSpamClicks)}
                            className="px-6 py-2 bg-white border border-blue-400 hover:bg-blue-50 text-blue-800 font-bold rounded shadow-sm text-sm mx-auto disabled:opacity-50"
                            style={attackButtonStyle}
                        >
                            {isAttacking ? 'Đang tấn công...' : 'Tấn Công'}
                        </button>
                    </div>
                )}
            </div>

            <div className="border border-slate-400 bg-white rounded overflow-hidden">
                <div className="bg-amber-50 border-b border-slate-300 text-center text-sm font-bold py-1.5">
                    Kết Quả Trận Đấu
                </div>
                <div className="p-3 text-center text-sm text-slate-700 min-h-20">
                    {actionMessage && <div className="font-semibold mb-1">{actionMessage}</div>}
                    {battleLog?.length > 0 ? (
                        battleLog.map((line, idx) => (
                            <div key={`${line}-${idx}`}>{line}</div>
                        ))
                    ) : (
                        <div className="text-slate-500">Chưa có hành động.</div>
                    )}
                </div>
            </div>

            {(!opponent?.team || opponent.team.length === 0) && (
                <div className="border border-slate-400 bg-white rounded overflow-hidden">
                    <div className="p-3 text-center text-xs text-slate-500">
                        Chưa cấu hình đội hình huấn luyện viên.
                    </div>
                </div>
            )}
        </div>
    )
}
export function BattlePage() {
    const { user } = useAuth()
    const location = useLocation()
    const navigate = useNavigate()
    const challengeSearchParams = new URLSearchParams(location.search)
    const rankedChallengePokemonId = String(challengeSearchParams.get('challengePokemonId') || '').trim()
    const onlineChallengeUserId = String(challengeSearchParams.get('challengeUserId') || '').trim()
    const rankedChallengeReturnTo = resolveSafeRankedReturnPath(challengeSearchParams.get('returnTo'))
    const isRankedChallengeRequested = Boolean(rankedChallengePokemonId)
    const isOnlineChallengeRequested = Boolean(onlineChallengeUserId)
    const isExternalChallengeRequested = isRankedChallengeRequested || isOnlineChallengeRequested
    const [maps, setMaps] = useState([])
    const [party, setParty] = useState([])
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState(isExternalChallengeRequested ? 'battle' : 'lobby')
    const [encounter, setEncounter] = useState(null)
    const [playerState, setPlayerState] = useState(null)
    const [opponent, setOpponent] = useState(null)
    const [battleOpponent, setBattleOpponent] = useState(null)
    const [actionMessage, setActionMessage] = useState('')
    const [battleResults, setBattleResults] = useState(null)
    const [masterPokemon, setMasterPokemon] = useState([])
    const [completedEntries, setCompletedEntries] = useState([])
    const [completedCarouselIndex, setCompletedCarouselIndex] = useState(0)
    const [completedEntriesPerView, setCompletedEntriesPerView] = useState(DESKTOP_COMPLETED_ENTRIES_PER_VIEW)
    const [hoveredCompletedId, setHoveredCompletedId] = useState(null)
    const [activeTab, setActiveTab] = useState('fight')
    const [inventory, setInventory] = useState([])
    const [selectedMoveIndex, setSelectedMoveIndex] = useState(0)
    const [battleLog, setBattleLog] = useState([])
    const [isAttacking, setIsAttacking] = useState(false)
    const [battlePlayerIndex, setBattlePlayerIndex] = useState(0)
    const [battlePartyHpState, setBattlePartyHpState] = useState([])
    const [activeBattleMode, setActiveBattleMode] = useState('trainer')
    const [duelOpponentMoves, setDuelOpponentMoves] = useState([])
    const [duelOpponentMoveCursor, setDuelOpponentMoveCursor] = useState(0)
    const [duelReturnPath, setDuelReturnPath] = useState(DEFAULT_RANKED_RETURN_PATH)
    const [duelResultModal, setDuelResultModal] = useState(null)
    const [isStartingRankedDuel, setIsStartingRankedDuel] = useState(false)
    const [isStartingOnlineChallenge, setIsStartingOnlineChallenge] = useState(false)
    const [shouldResetTrainerSession, setShouldResetTrainerSession] = useState(false)
    const [trainerAttackButtonOffset, setTrainerAttackButtonOffset] = useState({ x: 0, y: 0 })
    const [trainerAttackChallenge, setTrainerAttackChallenge] = useState(null)
    const [trainerAttackChallengeError, setTrainerAttackChallengeError] = useState('')
    const [autoTrainerAttackEnabled, setAutoTrainerAttackEnabled] = useState(false)
    const [autoTrainerStartedAtMs, setAutoTrainerStartedAtMs] = useState(0)
    const [autoTrainerAttackIntervalMs, setAutoTrainerAttackIntervalMs] = useState(DEFAULT_AUTO_TRAINER_ATTACK_INTERVAL_MS)
    const [autoTrainerTargetId, setAutoTrainerTargetId] = useState(() => readStoredAutoTrainerTargetId())
    const [autoTrainerServerStatus, setAutoTrainerServerStatus] = useState('')
    const [autoTrainerServerLogs, setAutoTrainerServerLogs] = useState([])
    const [isAutoTrainerConfigDirty, setIsAutoTrainerConfigDirty] = useState(false)
    const canUseVipAutoTrainer = hasVipAutoBattleTrainerAccess(user)
    const autoTrainerLimitConfig = getVipAutoLimitConfig(user, 'trainer-battle')
    const autoTrainerDurationLimitMinutes = autoTrainerLimitConfig.durationMinutes
    const [autoTrainerUsesPerDayLimit, setAutoTrainerUsesPerDayLimit] = useState(autoTrainerLimitConfig.usesPerDay)
    const [autoTrainerUsageToday, setAutoTrainerUsageToday] = useState(0)
    const [autoTrainerRuntimeTodayMinutes, setAutoTrainerRuntimeTodayMinutes] = useState(0)
    const [autoTrainerRuntimeLimitMinutes, setAutoTrainerRuntimeLimitMinutes] = useState(autoTrainerDurationLimitMinutes)
    const rankedChallengeLockRef = useRef('')
    const didInitLoadRef = useRef(false)
    const trainerAttackSpamCountRef = useRef(0)
    const trainerAttackRepositionTimerRef = useRef(null)
    const lastTrainerAttackChallengeAtRef = useRef(0)
    const lastTrainerAttackRepositionAtRef = useRef(0)
    const autoTrainerConfigDirtyRef = useRef(false)
    const lastAutoTrainerServerSnapshotRef = useRef('')

    const markAutoTrainerConfigDirty = () => {
        autoTrainerConfigDirtyRef.current = true
        setIsAutoTrainerConfigDirty(true)
    }

    const syncAutoTrainerConfigDirty = (nextDirty) => {
        const normalizedDirty = Boolean(nextDirty)
        autoTrainerConfigDirtyRef.current = normalizedDirty
        setIsAutoTrainerConfigDirty((prev) => (prev === normalizedDirty ? prev : normalizedDirty))
    }

    useEffect(() => {
        setAutoTrainerUsesPerDayLimit(autoTrainerLimitConfig.usesPerDay)
        setAutoTrainerRuntimeLimitMinutes(autoTrainerLimitConfig.durationMinutes)
    }, [autoTrainerLimitConfig.usesPerDay, autoTrainerLimitConfig.durationMinutes])

    useEffect(() => () => {
        if (typeof window === 'undefined') return
        if (trainerAttackRepositionTimerRef.current) {
            window.clearTimeout(trainerAttackRepositionTimerRef.current)
            trainerAttackRepositionTimerRef.current = null
        }
    }, [])

    useEffect(() => {
        if (activeBattleMode === 'trainer') return
        if (typeof window !== 'undefined' && trainerAttackRepositionTimerRef.current) {
            window.clearTimeout(trainerAttackRepositionTimerRef.current)
            trainerAttackRepositionTimerRef.current = null
        }
        trainerAttackSpamCountRef.current = 0
        setTrainerAttackButtonOffset({ x: 0, y: 0 })
        setTrainerAttackChallenge(null)
        setTrainerAttackChallengeError('')
    }, [activeBattleMode])

    const completedSlides = []
    for (let index = 0; index < completedEntries.length; index += completedEntriesPerView) {
        completedSlides.push(completedEntries.slice(index, index + completedEntriesPerView))
    }
    if (completedSlides.length === 0) {
        completedSlides.push([])
    }
    const completedSlideCount = completedSlides.length

    useEffect(() => {
        const normalizedCompletedIds = completedEntries
            .map((entry) => normalizeEntityId(entry?.id))
            .filter(Boolean)

        if (normalizedCompletedIds.length === 0) {
            return
        }

        const normalizedTargetId = normalizeEntityId(autoTrainerTargetId)
        if (normalizedTargetId && normalizedCompletedIds.includes(normalizedTargetId)) {
            writeStoredAutoTrainerTargetId(normalizedTargetId)
            return
        }

        if (normalizedTargetId) {
            return
        }

        const storedTargetId = readStoredAutoTrainerTargetId()
        if (storedTargetId && normalizedCompletedIds.includes(storedTargetId)) {
            setAutoTrainerTargetId(storedTargetId)
            return
        }

        const fallbackId = normalizedCompletedIds[0]
        if (fallbackId) {
            setAutoTrainerTargetId(fallbackId)
            writeStoredAutoTrainerTargetId(fallbackId)
        }
    }, [completedEntries, autoTrainerTargetId])

    const partyCandidates = party
        .map((slot, index) => {
            if (!slot?._id) return null
            return {
                id: String(slot._id),
                index,
                name: getBattlePokemonDisplayName(slot),
                level: Number(slot.level) || 1,
            }
        })
        .filter(Boolean)

    const markTrainerCompleted = async (trainerId) => {
        const normalizedId = String(trainerId || '').trim()
        if (!normalizedId) return null
        const res = await gameApi.completeTrainer(normalizedId)
        const completedTrainerIds = Array.isArray(res?.completedBattleTrainers)
            ? res.completedBattleTrainers
            : []
        return new Set(
            completedTrainerIds
                .map((id) => String(id || '').trim())
                .filter(Boolean)
        )
    }

    const buildBattlePartyState = (partySlots = []) => {
        return (Array.isArray(partySlots) ? partySlots : []).map((slot) => {
            if (!slot) return null
            const maxHp = Math.max(1, Number(slot?.battleMaxHp) || Number(slot?.stats?.hp) || 1)
            const currentHpRaw = Number(slot?.battleCurrentHp)
            const currentHp = Number.isFinite(currentHpRaw)
                ? Math.max(0, Math.min(maxHp, currentHpRaw))
                : maxHp
            return { currentHp, maxHp }
        })
    }

    const getNextAlivePartyIndex = (partySlots = [], hpState = [], currentIndex = -1) => {
        const total = Array.isArray(partySlots) ? partySlots.length : 0
        if (total === 0) return -1
        const startIndex = Number.isFinite(currentIndex) ? Math.floor(currentIndex) : -1

        for (let step = 1; step <= total; step += 1) {
            const idx = (startIndex + step + total) % total
            const slot = partySlots[idx]
            if (!slot) continue
            const maxHp = Math.max(1, Number(slot?.stats?.hp) || 1)
            const currentHpRaw = Number(hpState?.[idx]?.currentHp)
            const currentHp = clampValue(Number.isFinite(currentHpRaw) ? currentHpRaw : maxHp, 0, maxHp)
            if (currentHp > 0) return idx
        }

        return -1
    }

    const getStoredTrainerOrder = () => {
        const raw = window.localStorage.getItem(TRAINER_ORDER_STORAGE_KEY)
        const parsed = Number.parseInt(raw || '0', 10)
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
    }

    const setStoredTrainerOrder = (value) => {
        const parsed = Number.parseInt(String(value || '0'), 10)
        const normalized = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
        window.localStorage.setItem(TRAINER_ORDER_STORAGE_KEY, String(normalized))
        return normalized
    }

    const getTrainerOrderFromProgress = (trainers = [], completedTrainerIds = new Set()) => {
        if (!Array.isArray(trainers) || trainers.length === 0) return 0

        const normalizedCompleted = completedTrainerIds instanceof Set
            ? completedTrainerIds
            : new Set(
                (Array.isArray(completedTrainerIds) ? completedTrainerIds : [])
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
            )

        const firstUncompletedIndex = trainers.findIndex((trainer) => {
            const trainerId = normalizeEntityId(trainer?._id || trainer?.id)
            if (!trainerId) return true
            return !normalizedCompleted.has(trainerId)
        })

        if (firstUncompletedIndex !== -1) {
            return firstUncompletedIndex
        }

        return getStoredTrainerOrder() % trainers.length
    }

    const getTrainerByOrder = (trainers = [], preferredOrder = null) => {
        if (!Array.isArray(trainers) || trainers.length === 0) {
            return { trainer: null, trainerOrder: 0 }
        }
        const computedOrder = Number.isFinite(preferredOrder)
            ? Math.max(0, Math.floor(preferredOrder))
            : getStoredTrainerOrder()
        const trainerOrder = computedOrder % trainers.length
        return {
            trainer: trainers[trainerOrder],
            trainerOrder,
        }
    }

    const advanceTrainerOrder = (currentOrder, total) => {
        if (!Number.isFinite(total) || total <= 0) return 0
        const current = Number.isFinite(currentOrder) ? currentOrder : 0
        const nextOrder = (current + 1) % total
        window.localStorage.setItem(TRAINER_ORDER_STORAGE_KEY, String(nextOrder))
        return nextOrder
    }

    useEffect(() => {
        if (didInitLoadRef.current) return
        didInitLoadRef.current = true
        loadData()
    }, [])

    useEffect(() => {
        const updateEntriesPerView = () => {
            const nextValue = window.innerWidth < 640
                ? MOBILE_COMPLETED_ENTRIES_PER_VIEW
                : DESKTOP_COMPLETED_ENTRIES_PER_VIEW
            setCompletedEntriesPerView((prev) => (prev === nextValue ? prev : nextValue))
        }

        updateEntriesPerView()
        window.addEventListener('resize', updateEntriesPerView)
        return () => window.removeEventListener('resize', updateEntriesPerView)
    }, [])

    useEffect(() => {
        const lastSlide = Math.max(0, completedSlideCount - 1)
        setCompletedCarouselIndex((prev) => Math.min(prev, lastSlide))
    }, [completedSlideCount])

    useEffect(() => {
        if (!autoTrainerAttackEnabled || canUseVipAutoTrainer) return
        setAutoTrainerAttackEnabled(false)
        setActionMessage('Tài khoản hiện không có quyền lợi VIP để dùng auto battle trainer.')
    }, [autoTrainerAttackEnabled, canUseVipAutoTrainer])

    const applyAutoTrainerStatus = (status = {}, options = {}) => {
        const forceConfig = Boolean(options?.forceConfig)
        const serverSnapshot = buildAutoTrainerConfigSnapshot({
            enabled: Boolean(status?.enabled),
            trainerId: normalizeEntityId(status?.trainerId),
            attackIntervalMs: Math.max(450, Number(status?.attackIntervalMs) || DEFAULT_AUTO_TRAINER_ATTACK_INTERVAL_MS),
        })
        lastAutoTrainerServerSnapshotRef.current = serverSnapshot

        const shouldApplyConfig = forceConfig || !autoTrainerConfigDirtyRef.current
        if (shouldApplyConfig) {
            const normalizedStatusTrainerId = normalizeEntityId(status?.trainerId)
            setAutoTrainerAttackEnabled(Boolean(status?.enabled))
            setAutoTrainerTargetId(normalizedStatusTrainerId)
            writeStoredAutoTrainerTargetId(normalizedStatusTrainerId)
            setAutoTrainerAttackIntervalMs(Math.max(450, Number(status?.attackIntervalMs) || DEFAULT_AUTO_TRAINER_ATTACK_INTERVAL_MS))
            setAutoTrainerStartedAtMs(status?.startedAt ? new Date(status.startedAt).getTime() : 0)
            syncAutoTrainerConfigDirty(false)
        }

        setAutoTrainerUsageToday(Math.max(0, Number(status?.daily?.count) || 0))
        setAutoTrainerUsesPerDayLimit(Math.max(0, Number(status?.daily?.limit) || 0))
        setAutoTrainerRuntimeTodayMinutes(Math.max(0, Number(status?.daily?.runtimeMinutes) || 0))
        setAutoTrainerRuntimeLimitMinutes(Math.max(0, Number(status?.daily?.runtimeLimitMinutes) || autoTrainerDurationLimitMinutes || 0))

        const logs = Array.isArray(status?.logs) ? status.logs : []
        setAutoTrainerServerLogs(logs)
        const latestLogMessage = formatFriendlyAutoTrainerMessage(logs[0]?.message)
        setAutoTrainerServerStatus(
            (Boolean(status?.enabled)
                ? `Đang chạy ngầm. ${latestLogMessage || 'Đang tự chiến theo cấu hình.'}`
                : (latestLogMessage || 'Tự chiến huấn luyện viên đang tắt.'))
        )
    }

    useEffect(() => {
        const serverSnapshot = String(lastAutoTrainerServerSnapshotRef.current || '')
        if (!serverSnapshot) return

        const localSnapshot = buildAutoTrainerConfigSnapshot({
            enabled: autoTrainerAttackEnabled,
            trainerId: autoTrainerTargetId,
            attackIntervalMs: autoTrainerAttackIntervalMs,
        })

        const isDirty = localSnapshot !== serverSnapshot
        syncAutoTrainerConfigDirty(isDirty)
    }, [autoTrainerAttackEnabled, autoTrainerTargetId, autoTrainerAttackIntervalMs])

    useEffect(() => {
        if (!user || !isAutoTrainerConfigDirty) return undefined

        const timer = window.setTimeout(async () => {
            try {
                const res = await gameApi.updateAutoTrainerSettings({
                    enabled: autoTrainerAttackEnabled,
                    trainerId: normalizeEntityId(autoTrainerTargetId),
                    attackIntervalMs: Math.max(450, Number(autoTrainerAttackIntervalMs) || DEFAULT_AUTO_TRAINER_ATTACK_INTERVAL_MS),
                })
                applyAutoTrainerStatus(res?.autoTrainer || {}, { forceConfig: true })
            } catch (error) {
                setActionMessage(String(error?.message || 'Không thể đồng bộ cấu hình auto battle trainer.'))
            }
        }, 500)

        return () => {
            window.clearTimeout(timer)
        }
    }, [user?.id, isAutoTrainerConfigDirty, autoTrainerAttackEnabled, autoTrainerTargetId, autoTrainerAttackIntervalMs])

    useEffect(() => {
        if (!user) return undefined
        let cancelled = false

        const syncAutoTrainerStatus = async () => {
            try {
                const statusRes = await gameApi.getAutoTrainerStatus()
                const status = statusRes?.autoTrainer || {}
                if (cancelled) return
                applyAutoTrainerStatus(status)
            } catch (error) {
                if (!cancelled) {
                    setAutoTrainerServerStatus(formatFriendlyAutoTrainerMessage(String(error?.message || 'Không thể tải trạng thái auto trainer.')))
                }
            }
        }

        syncAutoTrainerStatus()
        const timer = window.setInterval(syncAutoTrainerStatus, autoTrainerAttackEnabled ? 2000 : 5000)

        return () => {
            cancelled = true
            window.clearInterval(timer)
        }
    }, [user?.id, view, autoTrainerAttackEnabled])

    useEffect(() => {
        if (!rankedChallengePokemonId) return
        if (loading || isStartingRankedDuel) return
        if (activeBattleMode === 'duel' && view === 'battle') return

        setDuelReturnPath(rankedChallengeReturnTo)
        if (partyCandidates.length === 0) {
            setActionMessage('Bạn cần có Pokemon trong đội hình để khiêu chiến BXH.')
            navigate(rankedChallengeReturnTo, { replace: true })
            return
        }

        const challengeKey = `${rankedChallengePokemonId}:smart:${rankedChallengeReturnTo}`
        if (rankedChallengeLockRef.current === challengeKey) return

        if (view !== 'battle') {
            setView('battle')
        }

        rankedChallengeLockRef.current = challengeKey
        setIsStartingRankedDuel(true)
        startRankedPokemonDuel(rankedChallengePokemonId)
            .finally(() => {
                rankedChallengeLockRef.current = ''
                setIsStartingRankedDuel(false)
                navigate('/battle', { replace: true })
            })
    }, [rankedChallengePokemonId, rankedChallengeReturnTo, loading, isStartingRankedDuel, partyCandidates.length, activeBattleMode, view])

    useEffect(() => {
        if (!onlineChallengeUserId) return
        if (loading || isStartingOnlineChallenge) return
        if (activeBattleMode === 'online' && view === 'battle') return

        setDuelReturnPath(rankedChallengeReturnTo)
        if (partyCandidates.length === 0) {
            setActionMessage('Bạn cần có Pokemon trong đội hình để khiêu chiến online.')
            navigate(rankedChallengeReturnTo, { replace: true })
            return
        }

        const challengeKey = `${onlineChallengeUserId}:online:${rankedChallengeReturnTo}`
        if (rankedChallengeLockRef.current === challengeKey) return

        if (view !== 'battle') {
            setView('battle')
        }

        rankedChallengeLockRef.current = challengeKey
        setIsStartingOnlineChallenge(true)
        startOnlineTrainerChallenge(onlineChallengeUserId)
            .finally(() => {
                rankedChallengeLockRef.current = ''
                setIsStartingOnlineChallenge(false)
                navigate('/battle', { replace: true })
            })
    }, [onlineChallengeUserId, rankedChallengeReturnTo, loading, isStartingOnlineChallenge, partyCandidates.length, activeBattleMode, view])

    const loadData = async () => {
        try {
            if (isExternalChallengeRequested) {
                const [allMaps, partyData, encounterData, profileData, inventoryData] = await Promise.all([
                    gameApi.getMaps(),
                    gameApi.getParty(),
                    gameApi.getActiveEncounter(),
                    gameApi.getProfile(),
                    gameApi.getInventory(),
                ])

                setMaps(allMaps)
                setParty(hydratePartyWithBattleHp(partyData))
                setEncounter(encounterData?.encounter || null)
                setPlayerState(profileData?.playerState || null)
                setInventory(inventoryData?.inventory || [])
                setMasterPokemon([])
                setCompletedEntries([])
                setCompletedCarouselIndex(0)
                setOpponent(null)
                setBattleOpponent(null)
                setBattlePlayerIndex(0)
                setBattlePartyHpState([])
                setActiveBattleMode('trainer')
                setDuelOpponentMoves([])
                setDuelOpponentMoveCursor(0)
                setDuelResultModal(null)
                return
            }

            const [allMaps, partyData, encounterData, profileData, trainerData, inventoryData] = await Promise.all([
                gameApi.getMaps(),
                gameApi.getParty(),
                gameApi.getActiveEncounter(),
                gameApi.getProfile(),
                gameApi.getBattleTrainers(),
                gameApi.getInventory(),
            ])
            setMaps(allMaps)
            setParty(hydratePartyWithBattleHp(partyData))
            setEncounter(encounterData?.encounter || null)
            setPlayerState(profileData?.playerState || null)
            const trainerList = trainerData?.trainers || []
            setMasterPokemon(trainerList)
            setInventory(inventoryData?.inventory || [])

            const completedTrainerIds = new Set(
                (Array.isArray(profileData?.user?.completedBattleTrainers)
                    ? profileData.user.completedBattleTrainers
                    : []
                )
                    .map((id) => String(id || '').trim())
                    .filter(Boolean)
            )
            const completedFromServer = buildCompletedEntries(trainerList)
                .filter((entry) => completedTrainerIds.has(String(entry.id)))
            setCompletedEntries(completedFromServer)
            setCompletedCarouselIndex(0)

            const syncedTrainerOrder = getTrainerOrderFromProgress(trainerList, completedTrainerIds)
            setStoredTrainerOrder(syncedTrainerOrder)
            const { trainer, trainerOrder } = getTrainerByOrder(trainerList, syncedTrainerOrder)
            const builtOpponent = buildOpponent(encounterData?.encounter || null, trainer, trainerOrder)
            setOpponent(builtOpponent)
            setBattleOpponent(builtOpponent)
            setBattlePlayerIndex(0)
            setBattlePartyHpState([])
            setActiveBattleMode('trainer')
            setDuelOpponentMoves([])
            setDuelOpponentMoveCursor(0)
            setDuelResultModal(null)

        } catch (error) {
            console.error('Tải dữ liệu thất bại', error)
        } finally {
            setLoading(false)
        }
    }

    const appendBattleLog = (lines) => {
        const normalized = (Array.isArray(lines) ? lines : [lines]).filter(Boolean)
        if (normalized.length === 0) return
        setBattleLog((prev) => [...normalized, ...prev].slice(0, 8))
    }

    const navigateBackToRankingsAfterDuel = () => {
        navigate(duelReturnPath || DEFAULT_RANKED_RETURN_PATH)
    }

    const showRankedDuelResultModal = ({ resultType, title, message }) => {
        setDuelResultModal({
            resultType: resultType === 'defeat' ? 'defeat' : 'win',
            title: String(title || '').trim() || 'Kết quả khiêu chiến BXH',
            message: String(message || '').trim() || 'Trận đấu đã kết thúc.',
        })
    }

    const closeRankedDuelResultModal = () => {
        setDuelResultModal(null)
        navigateBackToRankingsAfterDuel()
    }

    const clearTrainerAttackRepositionTimer = () => {
        if (typeof window === 'undefined') return
        if (trainerAttackRepositionTimerRef.current) {
            window.clearTimeout(trainerAttackRepositionTimerRef.current)
            trainerAttackRepositionTimerRef.current = null
        }
    }

    const isTrainerAttackButtonShifted = () => {
        return trainerAttackButtonOffset.x !== 0 || trainerAttackButtonOffset.y !== 0
    }

    const shouldUseTrainerAttackChallenge = () => {
        return activeBattleMode === 'trainer' && isMobileClient()
    }

    const resetTrainerAttackButtonOffset = () => {
        clearTrainerAttackRepositionTimer()
        setTrainerAttackButtonOffset({ x: 0, y: 0 })
    }

    const openTrainerAttackChallenge = () => {
        lastTrainerAttackChallengeAtRef.current = Date.now()
        setTrainerAttackChallenge(createTrainerAttackChallenge())
        setTrainerAttackChallengeError('')
    }

    const handleTrainerAttackChallengeAnswer = (selectedValue) => {
        if (!trainerAttackChallenge) return

        const numericChoice = Number(selectedValue)
        const correctAnswer = Number(trainerAttackChallenge.answer)

        if (numericChoice === correctAnswer) {
            setTrainerAttackChallenge(null)
            setTrainerAttackChallengeError('')
            trainerAttackSpamCountRef.current = 0
            resetTrainerAttackButtonOffset()
            setActionMessage('Đã xác minh thành công. Bạn có thể tiếp tục tấn công.')
            return
        }

        setTrainerAttackChallengeError('Sai mật mã. Hãy thử lại câu khác.')
        setTrainerAttackChallenge(createTrainerAttackChallenge())
    }

    const resolveTrainerAttackButtonOffset = () => {
        if (typeof window === 'undefined') return { x: 0, y: 0 }

        const viewportWidth = Number(window.innerWidth || 1024)
        const minX = viewportWidth < 640 ? 26 : 90
        const maxX = viewportWidth < 640 ? 50 : 150
        const minY = viewportWidth < 640 ? 12 : 28
        const maxY = viewportWidth < 640 ? 30 : 70
        const randomFarOffset = (min, max) => {
            const distance = min + Math.floor(Math.random() * Math.max(1, (max - min + 1)))
            return (Math.random() < 0.5 ? -1 : 1) * distance
        }

        return {
            x: randomFarOffset(minX, maxX),
            y: randomFarOffset(minY, maxY),
        }
    }

    const scheduleTrainerAttackButtonReposition = () => {
        if (typeof window === 'undefined') return
        clearTrainerAttackRepositionTimer()
        trainerAttackRepositionTimerRef.current = window.setTimeout(() => {
            trainerAttackRepositionTimerRef.current = null
            setTrainerAttackButtonOffset({ x: 0, y: 0 })
        }, TRAINER_ATTACK_REPOSITION_INTERVAL_MS)
    }

    const nudgeTrainerAttackButton = () => {
        if (typeof window === 'undefined') return

        lastTrainerAttackRepositionAtRef.current = Date.now()
        setTrainerAttackButtonOffset(resolveTrainerAttackButtonOffset())
        scheduleTrainerAttackButtonReposition()
    }

    const registerTrainerAttackSpamAttempt = () => {
        const nowMs = Date.now()
        const nextSpamCount = trainerAttackSpamCountRef.current + 1
        trainerAttackSpamCountRef.current = nextSpamCount

        if (shouldUseTrainerAttackChallenge()) {
            const shouldTriggerChallenge = nextSpamCount % TRAINER_ATTACK_MOBILE_CHALLENGE_THRESHOLD === 0
            const canTriggerChallenge = (nowMs - Number(lastTrainerAttackChallengeAtRef.current || 0)) >= TRAINER_ATTACK_ANTI_SPAM_UI_COOLDOWN_MS
            if (!trainerAttackChallenge && shouldTriggerChallenge && canTriggerChallenge) {
                openTrainerAttackChallenge()
            }

            if (trainerAttackChallenge || (shouldTriggerChallenge && canTriggerChallenge)) {
                setActionMessage('Chú ý: Trả lời mật mã để tiếp tục chiến đấu.')
            }
            return
        }

        const canRepositionButton = (nowMs - Number(lastTrainerAttackRepositionAtRef.current || 0)) >= TRAINER_ATTACK_ANTI_SPAM_UI_COOLDOWN_MS
        if (!isTrainerAttackButtonShifted() && canRepositionButton && (nextSpamCount % TRAINER_ATTACK_SPAM_REPOSITION_THRESHOLD === 0)) {
            nudgeTrainerAttackButton()
        }

        if (isTrainerAttackButtonShifted()) {
            setActionMessage('Chú ý: Nút tấn công đã đổi vị trí do thao tác quá nhanh.')
        }
    }

    const resolveAutoTrainerMove = () => {
        const activeSlot = party[battlePlayerIndex] || party.find((slot) => Boolean(slot)) || null
        if (!activeSlot) return null

        const normalizedMoves = normalizeMoveList(mergeBattleMoveNames(activeSlot.moves || []))

        if (normalizedMoves.length === 0) return null

        const activeEnemy = battleOpponent?.team?.[battleOpponent?.currentIndex || 0] || null
        const playerTypes = resolvePokemonTypes(activeSlot?.pokemonId?.types)
        const enemyTypes = resolvePokemonTypes(
            Array.isArray(activeEnemy?.types)
                ? activeEnemy.types
                : (Array.isArray(activeEnemy?.pokemon?.types) ? activeEnemy.pokemon.types : [])
        )

        const planOptions = buildBattlePlans({
            moves: normalizedMoves,
            playerTypes,
            targetTypes: enemyTypes,
        })

        const suggestedMove = planOptions.find((entry) => entry?.move)?.move || null
        if (suggestedMove && Number(suggestedMove.currentPp) > 0) {
            return suggestedMove
        }

        const selectedMove = normalizedMoves[selectedMoveIndex] || null
        if (selectedMove && Number(selectedMove.currentPp) > 0) {
            return selectedMove
        }

        return normalizedMoves.find((entry) => Number(entry?.currentPp) > 0) || selectedMove || normalizedMoves[0] || null
    }

    const handleAttack = async (selectedMove) => {
        const isTrainerBattle = activeBattleMode === 'trainer'

        if (isTrainerBattle && trainerAttackChallenge) {
            setActionMessage('Chú ý: Trả lời mật mã để tiếp tục chiến đấu.')
            return
        }

        if (isTrainerBattle && isTrainerAttackButtonShifted()) {
            resetTrainerAttackButtonOffset()
            trainerAttackSpamCountRef.current = 0
        }

        if (isAttacking || duelResultModal || !battleOpponent?.team?.length) {
            if (isTrainerBattle && isAttacking) {
                registerTrainerAttackSpamAttempt()
            }
            return
        }

        const currentIndex = battleOpponent.currentIndex || 0
        const target = battleOpponent.team[currentIndex]
        if (!target) return
        if (Number(target.currentHp ?? target.maxHp ?? 0) <= 0) {
            if (activeBattleMode === 'duel') {
                setActionMessage('Trận đấu 1v1 đã kết thúc. Hãy thoát ra để bắt đầu trận mới.')
            }
            return
        }

        const resolvedPartyState = Array.isArray(battlePartyHpState) && battlePartyHpState.length === party.length
            ? battlePartyHpState
            : buildBattlePartyState(party)
        const resolvedActiveIndex = party[battlePlayerIndex]
            ? battlePlayerIndex
            : getNextAlivePartyIndex(party, resolvedPartyState, -1)
        if (resolvedActiveIndex === -1) {
            setActionMessage('Bạn không còn Pokemon nào có thể chiến đấu.')
            return
        }
        if (resolvedActiveIndex !== battlePlayerIndex) {
            setBattlePlayerIndex(resolvedActiveIndex)
        }

        const activePokemon = party[resolvedActiveIndex] || null
        const activeName = activePokemon?.nickname || activePokemon?.pokemonId?.name || 'Pokemon'
        const activeHpState = resolvedPartyState[resolvedActiveIndex] || null
        const activeMaxHp = Math.max(
            1,
            Number(activeHpState?.maxHp)
            || Number(activePokemon?.battleMaxHp)
            || Number(activePokemon?.stats?.hp)
            || 1
        )
        const activeResultImage = resolvePokemonSprite({
            species: activePokemon?.pokemonId || {},
            formId: activePokemon?.formId,
            isShiny: Boolean(activePokemon?.isShiny),
        })
        const resolvedActiveHpState = activeHpState || { currentHp: activeMaxHp, maxHp: activeMaxHp }
        const playerCurrentHpForTurn = clampValue(
            Number.isFinite(Number(resolvedActiveHpState.currentHp)) ? Number(resolvedActiveHpState.currentHp) : activeMaxHp,
            0,
            activeMaxHp
        )

        if (playerCurrentHpForTurn <= 0) {
            const switchedIndex = getNextAlivePartyIndex(party, resolvedPartyState, resolvedActiveIndex)
            if (switchedIndex !== -1) {
                const switchedPokemon = party[switchedIndex]
                setBattlePlayerIndex(switchedIndex)
                setActionMessage(`${activeName} đã kiệt sức. ${switchedPokemon?.nickname || switchedPokemon?.pokemonId?.name || 'Pokemon'} ra sân.`)
            } else {
                setActionMessage('Pokemon của bạn đã kiệt sức. Hãy bắt đầu lại trận đấu.')
            }
            return
        }

        setIsAttacking(true)
        try {
            const duelTurnPayload = (activeBattleMode === 'duel' || activeBattleMode === 'online')
                ? {
                    opponentMoveMode: 'smart',
                    opponentMoveCursor: duelOpponentMoveCursor,
                    opponentMoves: duelOpponentMoves,
                }
                : {}

            const fallbackTrainerByOrder = Number.isInteger(Number(battleOpponent?.trainerOrder))
                ? masterPokemon[Math.max(0, Math.floor(Number(battleOpponent?.trainerOrder)))]
                : null
            const resolvedTrainerId = normalizeEntityId(
                battleOpponent?.trainerId
                || opponent?.trainerId
                || fallbackTrainerByOrder?._id
                || fallbackTrainerByOrder?.id
            )
            if (activeBattleMode === 'trainer' && !resolvedTrainerId) {
                setActionMessage('Không xác định được huấn luyện viên hiện tại. Hãy thoát trận và vào lại.')
                return
            }

            const res = await gameApi.battleAttack({
                moveName: selectedMove?.name,
                move: selectedMove,
                trainerId: resolvedTrainerId || null,
                activePokemonId: activePokemon?._id || null,
                fieldState: battleOpponent?.fieldState || {},
                opponent: {
                    name: target.name,
                    level: target.level,
                    currentHp: target.currentHp ?? target.maxHp,
                    maxHp: target.maxHp,
                    baseStats: target.baseStats || {},
                    status: target.status || '',
                    statusTurns: Number.isFinite(Number(target.statusTurns)) ? Math.max(0, Math.floor(Number(target.statusTurns))) : 0,
                    statStages: target.statStages || {},
                    damageGuards: target.damageGuards || {},
                    wasDamagedLastTurn: Boolean(target.wasDamagedLastTurn),
                    volatileState: target.volatileState || {},
                },
                player: {
                    level: activePokemon?.level || 1,
                    currentHp: playerCurrentHpForTurn,
                    maxHp: activeMaxHp,
                    baseStats: activePokemon?.stats || activePokemon?.pokemonId?.baseStats || {},
                    status: activePokemon?.status || '',
                    statusTurns: Number.isFinite(Number(activePokemon?.statusTurns)) ? Math.max(0, Math.floor(Number(activePokemon.statusTurns))) : 0,
                    statStages: activePokemon?.statStages || {},
                    damageGuards: activePokemon?.damageGuards || {},
                    wasDamagedLastTurn: Boolean(activePokemon?.wasDamagedLastTurn),
                    volatileState: activePokemon?.volatileState || {},
                },
                resetTrainerSession: activeBattleMode === 'trainer' && shouldResetTrainerSession,
                ...duelTurnPayload,
            })

            if (activeBattleMode === 'trainer' && shouldResetTrainerSession) {
                setShouldResetTrainerSession(false)
            }

            const battle = res?.battle || {}
            const damage = Number.isFinite(battle.damage) ? battle.damage : 1
            const nextHp = Number.isFinite(battle.currentHp)
                ? Math.max(0, battle.currentHp)
                : Math.max(0, (target.currentHp ?? target.maxHp) - damage)
            const moveName = battle?.move?.name || selectedMove?.name || 'Attack'
            const moveHit = battle?.move?.hit !== false
            const moveFallbackReason = String(battle?.move?.fallbackReason || '').trim()
            const moveFallbackFrom = String(battle?.move?.fallbackFrom || '').trim()
            const counterAttack = battle?.counterAttack || null
            const effectLogs = Array.isArray(battle?.effects?.logs)
                ? battle.effects.logs.filter((entry) => Boolean(String(entry || '').trim()))
                : []
            const opponentMoveState = battle?.opponentMoveState && typeof battle.opponentMoveState === 'object'
                ? battle.opponentMoveState
                : null

            if ((activeBattleMode === 'duel' || activeBattleMode === 'online') && opponentMoveState) {
                const nextCursorRaw = Number(opponentMoveState?.cursor)
                const nextCursor = Number.isFinite(nextCursorRaw) ? Math.max(0, Math.floor(nextCursorRaw)) : 0
                const nextMoves = Array.isArray(opponentMoveState?.moves)
                    ? opponentMoveState.moves.map((entry, idx) => ({
                        ...entry,
                        id: `duel-op-${idx}-${String(entry?.name || '').trim() || 'move'}`,
                    }))
                    : []
                setDuelOpponentMoveCursor(nextCursor)
                setDuelOpponentMoves(nextMoves)
            }

            if (battle?.player) {
                setParty((prevParty) => {
                    const nextParty = Array.isArray(prevParty) ? [...prevParty] : []
                    const targetSlot = nextParty[resolvedActiveIndex]
                    if (!targetSlot) return prevParty

                    const ppState = Array.isArray(battle.player.movePpState) ? battle.player.movePpState : null
                    const moveMap = new Map(
                        (ppState || []).map((entry) => [
                            String(entry?.moveName || '').trim().toLowerCase(),
                            {
                                name: String(entry?.moveName || '').trim(),
                                currentPp: Math.max(0, Number(entry?.currentPp || 0)),
                                maxPp: Math.max(1, Number(entry?.maxPp || 1)),
                                pp: Math.max(0, Number(entry?.currentPp || 0)),
                            },
                        ])
                    )

                    const sourceMoves = Array.isArray(targetSlot.moves) ? targetSlot.moves : []
                    const nextMoves = sourceMoves.map((entry) => {
                        const baseMove = typeof entry === 'string'
                            ? { name: String(entry || '').trim() }
                            : { ...(entry || {}) }
                        const name = String(baseMove?.name || baseMove?.moveName || '').trim()
                        const key = name.toLowerCase()
                        const ppPatch = moveMap.get(key)
                        if (!ppPatch) return baseMove
                        return {
                            ...baseMove,
                            ...ppPatch,
                            name: ppPatch.name || baseMove.name,
                        }
                    })

                    const nextStatus = String(battle.player?.status || '').trim().toLowerCase()
                    const nextStatusTurns = Number.isFinite(Number(battle.player?.statusTurns))
                        ? Math.max(0, Math.floor(Number(battle.player.statusTurns)))
                        : 0
                    const nextStatStages = battle.player?.statStages && typeof battle.player.statStages === 'object'
                        ? battle.player.statStages
                        : {}
                    const nextDamageGuards = battle.player?.damageGuards && typeof battle.player.damageGuards === 'object'
                        ? battle.player.damageGuards
                        : {}
                    const nextWasDamagedLastTurn = Boolean(battle.player?.wasDamagedLastTurn)
                    const nextVolatileState = battle.player?.volatileState && typeof battle.player.volatileState === 'object'
                        ? battle.player.volatileState
                        : {}

                    nextParty[resolvedActiveIndex] = {
                        ...targetSlot,
                        moves: nextMoves,
                        movePpState: ppState || targetSlot.movePpState || [],
                        status: nextStatus,
                        statusTurns: nextStatusTurns,
                        statStages: nextStatStages,
                        damageGuards: nextDamageGuards,
                        wasDamagedLastTurn: nextWasDamagedLastTurn,
                        volatileState: nextVolatileState,
                        battleCurrentHp: Number.isFinite(Number(battle.player?.currentHp))
                            ? Math.max(0, Number(battle.player.currentHp))
                            : Number(targetSlot?.battleCurrentHp || targetSlot?.stats?.hp || 0),
                        battleMaxHp: Math.max(
                            1,
                            Number(battle.player?.maxHp)
                            || Number(targetSlot?.battleMaxHp)
                            || Number(targetSlot?.stats?.hp)
                            || 1
                        ),
                    }
                    return nextParty
                })
            }

            let defeatedAll = false
            let defeatedName = ''
            let nextName = ''
            const currentBattleState = battleOpponent
            const currentBattleIndex = currentBattleState?.currentIndex || 0
            const targetStatePatch = battle?.targetState || null
            const localResolvedTeam = (currentBattleState?.team || []).map((member, index) => {
                if (index !== currentBattleIndex) return member
                return {
                    ...member,
                    currentHp: nextHp,
                    maxHp: targetStatePatch?.maxHp ?? member?.maxHp ?? 1,
                    status: String(targetStatePatch?.status || member?.status || '').trim().toLowerCase(),
                    statusTurns: Number.isFinite(Number(targetStatePatch?.statusTurns))
                        ? Math.max(0, Math.floor(Number(targetStatePatch.statusTurns)))
                        : Math.max(0, Math.floor(Number(member?.statusTurns) || 0)),
                    statStages: targetStatePatch?.statStages && typeof targetStatePatch.statStages === 'object'
                        ? targetStatePatch.statStages
                        : (member?.statStages || {}),
                    damageGuards: targetStatePatch?.damageGuards && typeof targetStatePatch.damageGuards === 'object'
                        ? targetStatePatch.damageGuards
                        : (member?.damageGuards || {}),
                    wasDamagedLastTurn: Boolean(targetStatePatch?.wasDamagedLastTurn ?? member?.wasDamagedLastTurn),
                    volatileState: targetStatePatch?.volatileState && typeof targetStatePatch.volatileState === 'object'
                        ? targetStatePatch.volatileState
                        : (member?.volatileState || {}),
                }
            })

            let nextBattleState = currentBattleState
            const serverOpponentState = battle?.opponent
            if (serverOpponentState && Array.isArray(serverOpponentState.team)) {
                const localTeam = Array.isArray(currentBattleState?.team) ? currentBattleState.team : []
                const mergedTeam = serverOpponentState.team.map((serverEntry, index) => {
                    const member = localTeam[index] || {}
                    return {
                        ...member,
                        ...serverEntry,
                        currentHp: serverEntry.currentHp ?? member?.currentHp ?? member?.maxHp ?? 0,
                        maxHp: serverEntry.maxHp ?? member?.maxHp ?? 1,
                        status: String(serverEntry.status || member?.status || '').trim().toLowerCase(),
                        statusTurns: Number.isFinite(Number(serverEntry.statusTurns))
                            ? Math.max(0, Math.floor(Number(serverEntry.statusTurns)))
                            : Math.max(0, Math.floor(Number(member?.statusTurns) || 0)),
                        statStages: serverEntry.statStages && typeof serverEntry.statStages === 'object'
                            ? serverEntry.statStages
                            : (member?.statStages || {}),
                        damageGuards: serverEntry.damageGuards && typeof serverEntry.damageGuards === 'object'
                            ? serverEntry.damageGuards
                            : (member?.damageGuards || {}),
                        wasDamagedLastTurn: Boolean(serverEntry.wasDamagedLastTurn ?? member?.wasDamagedLastTurn),
                        volatileState: serverEntry.volatileState && typeof serverEntry.volatileState === 'object'
                            ? serverEntry.volatileState
                            : (member?.volatileState || {}),
                    }
                })
                const serverCurrentIndex = Number.isInteger(serverOpponentState.currentIndex)
                    ? serverOpponentState.currentIndex
                    : currentBattleIndex

                const previousTargetHp = Number(currentBattleState?.team?.[currentBattleIndex]?.currentHp)
                const fallbackTargetHp = Number(currentBattleState?.team?.[currentBattleIndex]?.maxHp)
                const beforeHitHp = Number.isFinite(previousTargetHp)
                    ? previousTargetHp
                    : (Number.isFinite(fallbackTargetHp) ? fallbackTargetHp : 0)
                const afterHitHp = Number(mergedTeam?.[currentBattleIndex]?.currentHp ?? 0)
                if (beforeHitHp > 0 && afterHitHp <= 0) {
                    defeatedName = mergedTeam?.[currentBattleIndex]?.name || target.name || 'Pokemon'
                }

                defeatedAll = Boolean(serverOpponentState.defeatedAll) || serverCurrentIndex >= mergedTeam.length
                if (!defeatedAll && serverCurrentIndex !== currentBattleIndex) {
                    nextName = mergedTeam?.[serverCurrentIndex]?.name || 'Pokemon'
                }

                nextBattleState = {
                    ...currentBattleState,
                    ...serverOpponentState,
                    currentIndex: serverCurrentIndex,
                    team: mergedTeam,
                }
            } else {
                const activeEnemy = localResolvedTeam[currentBattleIndex]
                if (activeEnemy && activeEnemy.currentHp <= 0) {
                    defeatedName = activeEnemy.name || 'Pokemon'
                    const nextIndex = localResolvedTeam.findIndex((member, memberIndex) => {
                        if (memberIndex <= currentBattleIndex) return false
                        const hp = member.currentHp ?? member.maxHp ?? 0
                        return hp > 0
                    })
                    if (nextIndex !== -1) {
                        nextName = localResolvedTeam[nextIndex]?.name || 'Pokemon'
                        nextBattleState = { ...currentBattleState, team: localResolvedTeam, currentIndex: nextIndex }
                    } else {
                        defeatedAll = true
                        nextBattleState = { ...currentBattleState, team: localResolvedTeam }
                    }
                } else {
                    nextBattleState = { ...currentBattleState, team: localResolvedTeam }
                }
            }

            const nextFieldState = battle?.fieldState && typeof battle.fieldState === 'object'
                ? battle.fieldState
                : (nextBattleState?.fieldState && typeof nextBattleState.fieldState === 'object'
                    ? nextBattleState.fieldState
                    : {})
            nextBattleState = {
                ...nextBattleState,
                fieldState: nextFieldState,
            }

            setBattleOpponent(nextBattleState)

            const logLines = [
                moveHit
                    ? `${activeName} của bạn dùng ${moveName}! Gây ${damage} sát thương.`
                    : `${activeName} của bạn dùng ${moveName} nhưng trượt.`,
            ]
            if (moveFallbackReason === 'OUT_OF_PP') {
                logLines.unshift(`Chiêu ${moveFallbackFrom || 'đã chọn'} đã hết PP, hệ thống tự chuyển sang Struggle.`)
            }
            let nextPartyState = resolvedPartyState
            let authoritativePlayerHp = null
            let authoritativePlayerMaxHp = activeMaxHp
            if (battle?.player && Number.isFinite(battle.player.currentHp)) {
                authoritativePlayerMaxHp = Math.max(1, Number(battle.player.maxHp) || activeMaxHp)
                authoritativePlayerHp = clampValue(Number(battle.player.currentHp) || 0, 0, authoritativePlayerMaxHp)
            }

            let switchedAfterDefeat = false
            if (counterAttack) {
                const counterDamage = Number.isFinite(counterAttack.damage) ? counterAttack.damage : 0
                const counterMoveName = counterAttack?.move?.name || 'Phản công'
                const nextPlayerHpFromCounter = Number.isFinite(counterAttack.currentHp)
                    ? Math.max(0, counterAttack.currentHp)
                    : Math.max(0, playerCurrentHpForTurn - counterDamage)
                if (!Number.isFinite(authoritativePlayerHp)) {
                    authoritativePlayerMaxHp = Math.max(1, Number(counterAttack?.maxHp) || authoritativePlayerMaxHp || activeMaxHp)
                    authoritativePlayerHp = clampValue(nextPlayerHpFromCounter, 0, authoritativePlayerMaxHp)
                }
                logLines.push(`${target.name || 'Đối thủ'} dùng ${counterMoveName}! Gây ${counterDamage} sát thương.`)
            }

            if (Number.isFinite(authoritativePlayerHp)) {
                nextPartyState = resolvedPartyState.map((entry, idx) => {
                    if (idx !== resolvedActiveIndex) return entry
                    return {
                        currentHp: clampValue(authoritativePlayerHp, 0, authoritativePlayerMaxHp),
                        maxHp: authoritativePlayerMaxHp,
                    }
                })
            }

            if (effectLogs.length > 0) {
                logLines.push(...effectLogs)
            }

            setBattlePartyHpState(nextPartyState)

            const nextPlayerHp = clampValue(
                Number(nextPartyState?.[resolvedActiveIndex]?.currentHp) || 0,
                0,
                Number(nextPartyState?.[resolvedActiveIndex]?.maxHp) || activeMaxHp
            )
            if (nextPlayerHp <= 0) {
                logLines.push(`${activeName} đã bại trận.`)

                const switchedIndex = getNextAlivePartyIndex(party, nextPartyState, resolvedActiveIndex)
                if (switchedIndex !== -1) {
                    const switchedPokemon = party[switchedIndex]
                    setBattlePlayerIndex(switchedIndex)
                    switchedAfterDefeat = true
                    logLines.push(`${switchedPokemon?.nickname || switchedPokemon?.pokemonId?.name || 'Pokemon'} vào sân thay thế.`)
                    setActionMessage(`${activeName} bại trận. ${switchedPokemon?.nickname || switchedPokemon?.pokemonId?.name || 'Pokemon'} vào sân.`)
                }
            }
            if (nextHp <= 0) {
                logLines.push(`${target.name || 'Đối thủ'} đã bại trận.`)
            }
            appendBattleLog(logLines)

            if (switchedAfterDefeat) {
                return
            }

            if (nextPlayerHp <= 0) {
                if (activeBattleMode === 'duel' || activeBattleMode === 'online') {
                    const defeatedTargetName = target?.name || battleOpponent?.trainerName || (activeBattleMode === 'online' ? 'đối thủ online' : 'Đối thủ BXH')
                    setActionMessage('Pokemon của bạn đã bại trận.')
                    showRankedDuelResultModal({
                        resultType: 'defeat',
                        title: activeBattleMode === 'online' ? 'Thua Khiêu Chiến Online' : 'Thua Khiêu Chiến BXH',
                        message: activeBattleMode === 'online'
                            ? `Bạn đã thua trước đội hình của ${battleOpponent?.trainerName || defeatedTargetName}.`
                            : `Bạn đã thua trước ${defeatedTargetName}.`,
                    })
                    return
                }
                setActionMessage('Pokemon của bạn đã bại trận. Trận đấu kết thúc.')
                setBattleResults({
                    resultType: 'defeat',
                    message: 'Pokemon của bạn đã bại trận. Trận đấu kết thúc.',
                    pokemon: {
                        name: activeName,
                        imageUrl: activeResultImage,
                        level: activePokemon?.level || 1,
                        exp: activePokemon?.experience || 0,
                        expToNext: expToNextPokemonLevel(activePokemon?.level || 1),
                        levelsGained: 0,
                        happinessGained: 0,
                    },
                    rewards: {
                        coins: 0,
                        trainerExp: 0,
                        moonPoints: 0,
                        prizePokemon: null,
                        prizeItem: null,
                    },
                    evolution: {
                        evolved: false,
                        chain: [],
                    },
                })
                return
            }

            if (defeatedAll) {
                if (activeBattleMode === 'duel' || activeBattleMode === 'online') {
                    const defeatedTargetName = target?.name || battleOpponent?.trainerName || (activeBattleMode === 'online' ? 'đối thủ online' : 'Đối thủ BXH')
                    setActionMessage(activeBattleMode === 'online' ? 'Bạn đã chiến thắng trận khiêu chiến online.' : 'Bạn đã chiến thắng trận khiêu chiến BXH.')
                    showRankedDuelResultModal({
                        resultType: 'win',
                        title: activeBattleMode === 'online' ? 'Thắng Khiêu Chiến Online' : 'Thắng Khiêu Chiến BXH',
                        message: activeBattleMode === 'online'
                            ? `Bạn đã đánh bại đội hình của ${battleOpponent?.trainerName || defeatedTargetName}.`
                            : `Bạn đã đánh bại ${defeatedTargetName}.`,
                    })
                    return
                }
                setActionMessage('Bạn đã đánh bại toàn bộ đội hình đối thủ.')
                try {
                    const resResolve = await gameApi.resolveBattle(
                        nextBattleState?.team || battleOpponent.team,
                        currentBattleState?.trainerId || null
                    )
                    setBattleResults(resResolve.results)
                    if (Array.isArray(resResolve?.results?.pokemonRewards) && resResolve.results.pokemonRewards.length > 0) {
                        const rewardByPokemonId = new Map(
                            resResolve.results.pokemonRewards
                                .map((reward) => [String(reward?.userPokemonId || '').trim(), reward])
                                .filter(([id]) => Boolean(id))
                        )
                        setParty((prevParty) => (Array.isArray(prevParty) ? prevParty.map((slot) => {
                            if (!slot) return slot
                            const reward = rewardByPokemonId.get(String(slot?._id || '').trim())
                            if (!reward) return slot
                            return {
                                ...slot,
                                level: Math.max(1, Number(reward?.level) || Number(slot?.level) || 1),
                                experience: Math.max(0, Number(reward?.exp) || 0),
                            }
                        }) : prevParty))
                    }
                    if (resResolve?.wallet) {
                        setPlayerState((prev) => ({
                            ...(prev || {}),
                            platinumCoins: Number(resResolve.wallet?.platinumCoins ?? prev?.platinumCoins ?? 0),
                            moonPoints: Number(resResolve.wallet?.moonPoints ?? prev?.moonPoints ?? 0),
                        }))
                    }
                    try {
                        const refreshedParty = await gameApi.getParty()
                        setParty(hydratePartyWithBattleHp(refreshedParty))
                    } catch (refreshPartyError) {
                        console.error('Làm mới đội hình sau battle thất bại', refreshPartyError)
                    }
                    const entry = buildCompletedEntryFromBattle(currentBattleState)
                    const trainerNameForLog = String(entry?.name || currentBattleState?.trainerName || battleOpponent?.trainerName || 'Trainer').trim() || 'Trainer'
                    const trainerLevels = (Array.isArray(currentBattleState?.team) ? currentBattleState.team : [])
                        .map((member) => Math.max(1, Number(member?.level || 1)))
                    const trainerLevelForLog = trainerLevels.length > 0
                        ? Math.max(1, Math.round(trainerLevels.reduce((sum, level) => sum + level, 0) / trainerLevels.length))
                        : Math.max(1, Number(currentBattleState?.level || 1))
                    const autoWinLog = `Đã đánh bại huấn luyện viên ${trainerNameForLog} Lv ${trainerLevelForLog}.`
                    setAutoTrainerServerStatus(autoWinLog)
                    if (entry) {
                        try {
                            const completedTrainerIds = await markTrainerCompleted(entry.id)
                            if (completedTrainerIds) {
                                setCompletedCarouselIndex(0)
                                setCompletedEntries((prev) => {
                                    if (prev.some((item) => String(item.id) === String(entry.id))) return prev
                                    return [entry, ...prev]
                                })
                            }
                        } catch (saveProgressError) {
                            console.error('Lưu tiến trình huấn luyện viên hoàn thành thất bại', saveProgressError)
                        }
                    }

                    if (masterPokemon.length > 0) {
                        const nextOrder = advanceTrainerOrder(currentBattleState?.trainerOrder || 0, masterPokemon.length)
                        const nextTrainer = masterPokemon[nextOrder] || null
                        setOpponent(buildOpponent(null, nextTrainer, nextOrder))
                    }
                } catch (err) {
                    setActionMessage(err.message)
                }
            } else if (nextName) {
                setActionMessage(`${defeatedName} bại trận. ${nextName} tham chiến.`)
            } else {
                setActionMessage(`${moveName} gây ${damage} sát thương.`)
            }
        } catch (err) {
            setActionMessage(err.message)
            if (activeBattleMode === 'trainer') {
                const isCooldownError = err?.code === 'ACTION_COOLDOWN' || /quá nhanh/i.test(String(err?.message || ''))
                if (isCooldownError) {
                    registerTrainerAttackSpamAttempt()
                }
            }
            if (String(err?.message || '').toLowerCase().includes('bại trận')) {
                if (activeBattleMode === 'duel' || activeBattleMode === 'online') {
                    showRankedDuelResultModal({
                        resultType: 'defeat',
                        title: activeBattleMode === 'online' ? 'Thua Khiêu Chiến Online' : 'Thua Khiêu Chiến BXH',
                        message: err.message || 'Pokemon của bạn đã bại trận.',
                    })
                    return
                }
                setBattleResults((prev) => prev || {
                    resultType: 'defeat',
                    message: err.message,
                    pokemon: {
                        name: activeName,
                        imageUrl: activeResultImage,
                        level: activePokemon?.level || 1,
                        exp: activePokemon?.experience || 0,
                        expToNext: expToNextPokemonLevel(activePokemon?.level || 1),
                        levelsGained: 0,
                        happinessGained: 0,
                    },
                    rewards: {
                        coins: 0,
                        trainerExp: 0,
                        moonPoints: 0,
                        prizePokemon: null,
                        prizeItem: null,
                    },
                    evolution: {
                        evolved: false,
                        chain: [],
                    },
                })
            }
        } finally {
            setIsAttacking(false)
        }
    }

    useEffect(() => {
        return undefined
    }, [
        autoTrainerAttackEnabled,
    ])

    const handlePlanMove = (nextMoveIndex, note = '') => {
        if (!Number.isInteger(nextMoveIndex) || nextMoveIndex < 0) return
        setSelectedMoveIndex(nextMoveIndex)
        setActiveTab('fight')
        const resolvedNote = String(note || '').trim() || 'Đã cập nhật kế hoạch đánh cho lượt tiếp theo.'
        setActionMessage(resolvedNote)
        appendBattleLog([resolvedNote])
    }

    const handleSwitchParty = (targetIndex) => {
        if (isAttacking) return
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= party.length) return
        if (targetIndex === battlePlayerIndex) return

        const targetSlot = party[targetIndex]
        if (!targetSlot) return
        const targetHpEntry = Array.isArray(battlePartyHpState) ? battlePartyHpState[targetIndex] : null
        const targetMaxHp = Math.max(1, Number(targetHpEntry?.maxHp) || Number(targetSlot?.battleMaxHp) || Number(targetSlot?.stats?.hp) || 1)
        const targetCurrentHp = clampValue(
            Number.isFinite(Number(targetHpEntry?.currentHp))
                ? Number(targetHpEntry.currentHp)
                : (Number.isFinite(Number(targetSlot?.battleCurrentHp)) ? Number(targetSlot.battleCurrentHp) : targetMaxHp),
            0,
            targetMaxHp
        )

        if (targetCurrentHp <= 0) {
            const message = `${getBattlePokemonDisplayName(targetSlot)} đã kiệt sức và không thể ra sân.`
            setActionMessage(message)
            appendBattleLog([message])
            return
        }

        const activeSlot = party[battlePlayerIndex] || null
        const fromName = activeSlot ? getBattlePokemonDisplayName(activeSlot) : 'Pokemon hiện tại'
        const toName = getBattlePokemonDisplayName(targetSlot)
        setBattlePlayerIndex(targetIndex)
        setSelectedMoveIndex(0)
        setActiveTab('fight')
        const message = `Đổi đội hình: ${fromName} rút lui, ${toName} vào sân.`
        setActionMessage(message)
        appendBattleLog([message])
    }

    const handleUseItem = async (entry) => {
        if (!entry?.item?._id) return
        if (entry.item?.type !== 'healing') {
            const message = 'Trong battle này chỉ dùng được vật phẩm hồi phục.'
            setActionMessage(message)
            appendBattleLog([message])
            return
        }
        if (activeBattleMode === 'duel' || activeBattleMode === 'online') {
            const message = 'Không thể dùng vật phẩm trong chế độ khiêu chiến này.'
            setActionMessage(message)
            appendBattleLog([message])
            return
        }
        if (activeBattleMode !== 'trainer') {
            const message = 'Không xác định được ngữ cảnh battle để dùng vật phẩm.'
            setActionMessage(message)
            appendBattleLog([message])
            return
        }
        try {
            const activeSlot = party[battlePlayerIndex] || party.find((slot) => Boolean(slot)) || null
            if (!activeSlot?._id) {
                const message = 'Không tìm thấy Pokemon đang chiến đấu để dùng vật phẩm.'
                setActionMessage(message)
                appendBattleLog([message])
                return
            }

            const fallbackTrainerByOrder = Number.isInteger(Number(battleOpponent?.trainerOrder))
                ? masterPokemon[Math.max(0, Math.floor(Number(battleOpponent?.trainerOrder)))]
                : null
            const resolvedTrainerId = normalizeEntityId(
                battleOpponent?.trainerId
                || opponent?.trainerId
                || fallbackTrainerByOrder?._id
                || fallbackTrainerByOrder?.id
            )
            if (!resolvedTrainerId) {
                const message = 'Không xác định được battle trainer hiện tại để dùng vật phẩm.'
                setActionMessage(message)
                appendBattleLog([message])
                return
            }

            const activeHpEntry = Array.isArray(battlePartyHpState) ? battlePartyHpState[battlePlayerIndex] : null
            const playerMaxHpForContext = Math.max(
                1,
                Number(activeHpEntry?.maxHp)
                || Number(activeSlot?.battleMaxHp)
                || Number(activeSlot?.stats?.hp)
                || 1
            )
            const playerCurrentHpForContext = clampValue(
                Number.isFinite(Number(activeHpEntry?.currentHp))
                    ? Number(activeHpEntry.currentHp)
                    : (Number.isFinite(Number(activeSlot?.battleCurrentHp)) ? Number(activeSlot.battleCurrentHp) : playerMaxHpForContext),
                0,
                playerMaxHpForContext
            )

            const res = await gameApi.useItem(
                entry.item._id,
                1,
                null,
                activeSlot._id,
                '',
                {
                    mode: 'trainer',
                    trainerId: resolvedTrainerId,
                    playerCurrentHp: playerCurrentHpForContext,
                    playerMaxHp: playerMaxHpForContext,
                }
            )
            setActionMessage(res.message || 'Đã dùng vật phẩm.')
            appendBattleLog([res.message || 'Đã dùng vật phẩm.'])

            if (res?.effect?.type === 'healing' && Number(res?.effect?.healedHp) > 0 && res?.effect?.hpContext === 'battle') {
                setBattlePartyHpState((prev) => {
                    const next = Array.isArray(prev) ? [...prev] : []
                    const resolvedIndex = Number.isInteger(battlePlayerIndex) ? battlePlayerIndex : 0
                    const entryState = next[resolvedIndex] || { currentHp: 0, maxHp: 1 }
                    next[resolvedIndex] = {
                        currentHp: Math.max(0, Number(res.effect.hp || entryState.currentHp || 0)),
                        maxHp: Math.max(1, Number(res.effect.maxHp || entryState.maxHp || 1)),
                    }
                    return next
                })
            }

            const inventoryData = await gameApi.getInventory()
            setInventory(inventoryData?.inventory || [])
            const refreshedParty = await gameApi.getParty()
            const mergedBattleParty = (Array.isArray(refreshedParty) ? refreshedParty : []).map((slot, idx) => {
                if (!slot) return slot
                const fallbackMaxHp = Math.max(1, Number(slot?.stats?.hp) || 1)
                const hpState = Array.isArray(battlePartyHpState) ? battlePartyHpState[idx] : null
                const mergedMaxHp = Math.max(1, Number(hpState?.maxHp) || Number(slot?.battleMaxHp) || fallbackMaxHp)
                const mergedCurrentHpRaw = Number(hpState?.currentHp)
                const mergedCurrentHp = Number.isFinite(mergedCurrentHpRaw)
                    ? Math.max(0, Math.min(mergedMaxHp, mergedCurrentHpRaw))
                    : mergedMaxHp
                return {
                    ...slot,
                    battleCurrentHp: mergedCurrentHp,
                    battleMaxHp: mergedMaxHp,
                }
            })
            setParty(mergedBattleParty)
        } catch (err) {
            setActionMessage(err.message)
        }
    }

    const handleRun = async () => {
        if (autoTrainerAttackEnabled) {
            setAutoTrainerAttackEnabled(false)
        }
        if (activeBattleMode === 'duel' || activeBattleMode === 'online') {
            navigateBackToRankingsAfterDuel()
            return
        }
        if (!encounter?._id) {
            setActionMessage('Bạn đã thoát.')
            appendBattleLog(['Bạn đã thoát.'])
            setView('lobby')
            return
        }
        try {
            const res = await gameApi.runEncounter(encounter._id)
            setActionMessage(res.message || 'Bạn đã thoát.')
            appendBattleLog([res.message || 'Bạn đã thoát.'])
            setView('lobby')
            setEncounter(null)
            setBattlePartyHpState([])
            setBattlePlayerIndex(0)
        } catch (err) {
            setActionMessage(err.message)
        }
    }

    const resolveBattleStats = (pokemonStats = {}, formStats = {}) => {
        const baseHp = Number(formStats?.hp) || Number(pokemonStats?.hp) || 1
        const baseAtk = Number(formStats?.atk) || Number(pokemonStats?.atk) || 1
        const baseDef = Number(formStats?.def) || Number(pokemonStats?.def) || 1
        const baseSpAtk = Number(formStats?.spatk) || Number(pokemonStats?.spatk) || 1
        const baseSpDef = Number(formStats?.spdef) || Number(formStats?.spldef) || Number(pokemonStats?.spdef) || Number(pokemonStats?.spldef) || 1
        const baseSpd = Number(formStats?.spd) || Number(pokemonStats?.spd) || 1

        return {
            hp: Math.max(1, Math.floor(baseHp)),
            atk: Math.max(1, Math.floor(baseAtk)),
            def: Math.max(1, Math.floor(baseDef)),
            spatk: Math.max(1, Math.floor(baseSpAtk)),
            spdef: Math.max(1, Math.floor(baseSpDef)),
            spd: Math.max(1, Math.floor(baseSpd)),
        }
    }

    const resolveTrainerTeamEntry = (entry = {}) => {
        const poke = entry.pokemonId || entry.pokemon || null
        const normalizedFormId = String(entry?.formId || poke?.defaultFormId || 'normal').trim() || 'normal'
        const forms = Array.isArray(poke?.forms) ? poke.forms : []
        const form = forms.find((candidate) => String(candidate?.formId || '').trim() === normalizedFormId) || null
        const resolvedStats = resolveBattleStats(poke?.baseStats || {}, form?.stats || {})
        const resolvedSprite = form?.imageUrl || form?.sprites?.normal || form?.sprites?.icon || getPokemonSprite(poke)

        return {
            poke,
            formId: normalizedFormId,
            formName: form?.formName || normalizedFormId,
            baseStats: resolvedStats,
            sprite: resolvedSprite,
        }
    }

    const getPokemonSprite = (pokemon) => {
        if (!pokemon) return ''
        return pokemon.imageUrl || pokemon.sprites?.normal || pokemon.sprites?.front_default || ''
    }

    const pickRandom = (list, count) => {
        if (!Array.isArray(list) || list.length === 0) return []
        const picked = []
        const used = new Set()
        while (picked.length < Math.min(count, list.length)) {
            const index = Math.floor(Math.random() * list.length)
            if (used.has(index)) continue
            used.add(index)
            picked.push(list[index])
        }
        return picked
    }

    const buildOpponent = (currentEncounter, trainer = null, trainerOrder = 0) => {

        const team = (trainer?.team || []).map((entry) => {
            const resolvedEntry = resolveTrainerTeamEntry(entry)
            const poke = resolvedEntry.poke
            const baseStats = resolvedEntry.baseStats
            const hp = Math.max(1, (baseStats.hp || 1) + ((entry.level || 1) - 1))
            return {
                id: poke?._id || entry.pokemonId,
                name: poke?.name || 'Pokemon',
                level: entry.level || 1,
                sprite: resolvedEntry.sprite,
                formId: resolvedEntry.formId,
                formName: resolvedEntry.formName,
                baseStats,
                pokemon: poke,
                types: resolvePokemonTypes(poke?.types),
                currentHp: hp,
                maxHp: hp,
                status: '',
                statusTurns: 0,
                statStages: {},
                damageGuards: {},
                wasDamagedLastTurn: false,
                volatileState: {},
            }
        })

        return {
            trainerId: normalizeEntityId(trainer?._id || trainer?.id) || null,
            trainerOrder,
            trainerName: trainer?.name || 'Trainer',
            trainerImage: trainer?.imageUrl || '/assets/08_trainer_female.png',
            trainerQuote: trainer?.quote || 'Good luck!',
            trainerPrize: trainer?.prizePokemonId?.name || 'Không có',
            trainerPrizeItem: trainer?.prizeItemId?.name || 'Không có',
            trainerPrizeItemQuantity: Math.max(1, Number(trainer?.prizeItemQuantity) || 1),
            trainerAutoGenerated: Boolean(trainer?.autoGenerated),
            trainerCoinsReward: Math.max(0, Number(trainer?.platinumCoinsReward) || 0),
            trainerExpReward: Math.max(0, Number(trainer?.expReward) || 0),
            trainerMoonPointsReward: Math.max(0, Number(trainer?.moonPointsReward) || 0),
            currentIndex: 0,
            level: currentEncounter?.level || 1,
            hp: currentEncounter?.hp || 1,
            maxHp: currentEncounter?.maxHp || 1,
            pokemon: currentEncounter?.pokemon || null,
            team,
            fieldState: {},
        }
    }

    const buildCompletedEntryFromBattle = (battleData) => {
        if (!battleData) return null
        const team = (battleData.team || []).map((poke, index) => ({
            id: poke.id || `${battleData.trainerId || battleData.trainerName || 'trainer'}-${index}`,
            name: poke.name || 'Pokemon',
            level: poke.level || 1,
            sprite: poke.sprite || '',
        }))
        return {
            id: battleData.trainerId || battleData.trainerName || `trainer-${Date.now()}`,
            name: battleData.trainerName || 'Trainer',
            image: battleData.trainerImage || '/assets/08_trainer_female.png',
            quote: battleData.trainerQuote || '',
            team,
            prize: battleData.trainerPrize || 'Không có',
        }
    }

    const buildCompletedEntries = (trainerList) => {
        return trainerList.map((trainer) => {
            const team = (trainer.team || []).map((entry) => {
                const resolvedEntry = resolveTrainerTeamEntry(entry)
                const poke = resolvedEntry.poke
                return {
                    id: poke?._id || entry.pokemonId,
                    name: poke?.name || 'Pokemon',
                    level: entry.level || 1,
                    sprite: resolvedEntry.sprite,
                }
            })
            return {
                id: normalizeEntityId(trainer?._id || trainer?.id),
                name: trainer.name,
                image: trainer.imageUrl || '/assets/08_trainer_female.png',
                quote: trainer.quote || '',
                team,
                prize: trainer.prizePokemonId?.name || 'Không có',
            }
        })
    }

    const resolveTrainerOpponentById = (trainerId) => {
        const normalizedId = normalizeEntityId(trainerId)
        if (!normalizedId) return null

        const trainerOrder = masterPokemon.findIndex(
            (trainer) => normalizeEntityId(trainer?._id || trainer?.id) === normalizedId
        )
        if (trainerOrder === -1) {
            return null
        }

        const trainer = masterPokemon[trainerOrder]
        return buildOpponent(null, trainer, trainerOrder)
    }

    const startBattleWithOpponent = (candidateOpponent = null) => {
        const fallbackSelection = getTrainerByOrder(masterPokemon)
        const nextOpponent = candidateOpponent || opponent || buildOpponent(null, fallbackSelection.trainer, fallbackSelection.trainerOrder)

        if (!nextOpponent?.team?.length) {
            setActionMessage('Không có đội hình huấn luyện viên để chiến đấu.')
            return
        }

        setBattleResults(null)
        setBattleLog([])
        setActionMessage('')
        setSelectedMoveIndex(0)
        setActiveTab('fight')
        setActiveBattleMode('trainer')
        setShouldResetTrainerSession(true)
        setDuelOpponentMoves([])
        setDuelOpponentMoveCursor(0)
        setDuelResultModal(null)
        setBattleOpponent(nextOpponent)
        const preparedParty = (Array.isArray(party) ? party : []).map((slot) => {
            if (!slot) return slot
            const maxHp = Math.max(1, Number(slot?.stats?.hp) || 1)
            const refilledMoveData = buildRefilledBattleMoves(slot)
            return {
                ...slot,
                moves: refilledMoveData.moves,
                movePpState: refilledMoveData.movePpState,
                status: '',
                statusTurns: 0,
                statStages: {},
                damageGuards: {},
                wasDamagedLastTurn: false,
                volatileState: {},
                battleCurrentHp: maxHp,
                battleMaxHp: maxHp,
            }
        })
        setParty(preparedParty)
        const initialPartyState = buildBattlePartyState(preparedParty)
        setBattlePartyHpState(initialPartyState)
        const initialIndex = getNextAlivePartyIndex(preparedParty, initialPartyState, -1)
        setBattlePlayerIndex(Math.max(0, initialIndex))
        setView('battle')
    }

    const startRankedPokemonDuel = async (targetPokemonId) => {
        const normalizedTargetId = String(targetPokemonId || '').trim()
        if (!normalizedTargetId) {
            setActionMessage('Thiếu Pokemon mục tiêu để khiêu chiến.')
            return
        }

        const attackerCandidate = partyCandidates[0]
            || null
        if (!attackerCandidate) {
            setActionMessage('Bạn chưa có Pokemon trong đội hình để khiêu chiến.')
            return
        }

        const attackerSlot = party[attackerCandidate.index] || null
        if (!attackerSlot) {
            setActionMessage('Không tìm thấy Pokemon của bạn trong đội hình hiện tại.')
            return
        }

        try {
            const targetPokemon = await gameApi.getPokemonDetail(normalizedTargetId)
            const targetSpecies = targetPokemon?.pokemonId || {}
            const targetLevel = Math.max(1, Number(targetPokemon?.level) || 1)
            const targetStats = targetPokemon?.stats || {}
            const targetMaxHp = Math.max(1, Number(targetStats?.maxHp || targetStats?.hp) || 1)

            const targetMoves = Array.isArray(targetPokemon?.moveDetails) && targetPokemon.moveDetails.length > 0
                ? targetPokemon.moveDetails
                : mergeBattleMoveNames(targetPokemon?.moves || [])
            const defenderMoves = normalizeMoveList(
                (Array.isArray(targetMoves) ? targetMoves : []).map((entry) => {
                    const maxPp = Number(entry?.maxPp ?? entry?.pp)
                    const resolvedMaxPp = Number.isFinite(maxPp) && maxPp > 0 ? Math.floor(maxPp) : 10
                    return {
                        ...(entry || {}),
                        maxPp: resolvedMaxPp,
                        currentPp: resolvedMaxPp,
                    }
                })
            ).map((entry, index) => ({
                ...entry,
                id: `ranked-op-${index}-${entry.name}`,
            }))

            const duelOpponent = {
                trainerId: null,
                trainerOrder: 0,
                trainerName: `BXH: ${getBattlePokemonDisplayName(targetPokemon)}`,
                trainerImage: resolvePokemonSprite({
                    species: targetSpecies,
                    formId: targetPokemon?.formId,
                    isShiny: Boolean(targetPokemon?.isShiny),
                }),
                trainerQuote: 'Auto chọn kỹ năng thông minh',
                trainerPrize: 'Không có',
                trainerPrizeItem: 'Không có',
                trainerPrizeItemQuantity: 1,
                trainerCoinsReward: 0,
                trainerExpReward: 0,
                trainerMoonPointsReward: 0,
                currentIndex: 0,
                level: targetLevel,
                hp: targetMaxHp,
                maxHp: targetMaxHp,
                pokemon: targetSpecies,
                team: [{
                    id: targetPokemon?._id || normalizedTargetId,
                    name: getBattlePokemonDisplayName(targetPokemon),
                    level: targetLevel,
                    sprite: resolvePokemonSprite({
                        species: targetSpecies,
                        formId: targetPokemon?.formId,
                        isShiny: Boolean(targetPokemon?.isShiny),
                    }),
                    baseStats: targetStats,
                    types: resolvePokemonTypes(targetSpecies?.types),
                    currentHp: targetMaxHp,
                    maxHp: targetMaxHp,
                    status: '',
                    statusTurns: 0,
                    statStages: {},
                    damageGuards: {},
                    wasDamagedLastTurn: false,
                    volatileState: {},
                }],
                fieldState: {},
            }

            const preparedParty = (Array.isArray(party) ? party : []).map((slot, index) => {
                if (!slot) return slot
                const maxHp = Math.max(1, Number(slot?.stats?.hp) || 1)
                const refilledMoveData = buildRefilledBattleMoves(slot)
                if (index !== attackerCandidate.index) {
                    return {
                        ...slot,
                        moves: refilledMoveData.moves,
                        movePpState: refilledMoveData.movePpState,
                        status: '',
                        statusTurns: 0,
                        statStages: {},
                        damageGuards: {},
                        wasDamagedLastTurn: false,
                        volatileState: {},
                        battleCurrentHp: 0,
                        battleMaxHp: maxHp,
                    }
                }

                return {
                    ...slot,
                    moves: refilledMoveData.moves,
                    movePpState: refilledMoveData.movePpState,
                    status: '',
                    statusTurns: 0,
                    statStages: {},
                    damageGuards: {},
                    wasDamagedLastTurn: false,
                    volatileState: {},
                    battleCurrentHp: maxHp,
                    battleMaxHp: maxHp,
                }
            })
            setParty(preparedParty)

            const initialPartyState = buildBattlePartyState(preparedParty)

            setBattleResults(null)
            setBattleLog([])
            setActionMessage(`Bạn khiêu chiến ${getBattlePokemonDisplayName(targetPokemon)} từ BXH.`)
            setSelectedMoveIndex(0)
            setActiveTab('fight')
            setActiveBattleMode('duel')
            setShouldResetTrainerSession(false)
            setDuelResultModal(null)
            setOpponent(duelOpponent)
            setBattleOpponent(duelOpponent)
            setBattlePlayerIndex(attackerCandidate.index)
            setBattlePartyHpState(initialPartyState)
            setDuelOpponentMoves(defenderMoves)
            setDuelOpponentMoveCursor(0)
            setView('battle')
        } catch (error) {
            setActionMessage(error?.message || 'Không thể bắt đầu trận khiêu chiến từ BXH.')
        }
    }

    const startOnlineTrainerChallenge = async (targetUserId) => {
        const normalizedTargetUserId = String(targetUserId || '').trim()
        if (!normalizedTargetUserId) {
            setActionMessage('Thiếu huấn luyện viên mục tiêu để khiêu chiến online.')
            return
        }

        if (partyCandidates.length === 0) {
            setActionMessage('Bạn chưa có Pokemon trong đội hình để khiêu chiến online.')
            return
        }

        try {
            const challengeData = await gameApi.getOnlineChallengeTarget(normalizedTargetUserId)
            const trainer = challengeData?.trainer || {}
            const trainerName = String(trainer?.username || '').trim() || 'Huấn luyện viên online'
            const trainerParty = (Array.isArray(trainer?.party) ? trainer.party : []).filter(Boolean)

            if (trainerParty.length === 0) {
                setActionMessage(`${trainerName} chưa có Pokemon trong đội hình để khiêu chiến.`)
                return
            }

            const duelTeam = trainerParty.map((entry, index) => {
                const level = Math.max(1, Number(entry?.level || 1))
                const resolvedEntry = resolveTrainerTeamEntry({
                    pokemonId: entry?.pokemonId,
                    formId: entry?.formId,
                    level,
                })
                const poke = resolvedEntry.poke || entry?.pokemonId || {}
                const baseStats = resolvedEntry.baseStats || resolveBattleStats(poke?.baseStats || {}, {})
                const hp = Math.max(1, (baseStats.hp || 1) + (level - 1))

                return {
                    id: entry?._id || `${normalizedTargetUserId}-${index}`,
                    name: String(entry?.nickname || poke?.name || `Pokemon ${index + 1}`).trim() || `Pokemon ${index + 1}`,
                    level,
                    sprite: resolvedEntry.sprite || resolvePokemonSprite({
                        species: poke,
                        formId: entry?.formId,
                        isShiny: Boolean(entry?.isShiny),
                    }),
                    formId: resolvedEntry.formId || String(entry?.formId || 'normal').trim() || 'normal',
                    formName: resolvedEntry.formName || String(entry?.formId || 'normal').trim() || 'normal',
                    baseStats,
                    pokemon: poke,
                    types: resolvePokemonTypes(poke?.types),
                    currentHp: hp,
                    maxHp: hp,
                    status: '',
                    statusTurns: 0,
                    statStages: {},
                    damageGuards: {},
                    wasDamagedLastTurn: false,
                    volatileState: {},
                }
            })

            if (duelTeam.length === 0) {
                setActionMessage(`${trainerName} chưa có Pokemon hợp lệ để khiêu chiến.`)
                return
            }

            const leadPokemon = duelTeam[0]
            const onlineOpponent = {
                trainerId: null,
                trainerOrder: 0,
                trainerName,
                trainerImage: resolveAvatarUrl(trainer?.avatar, '/assets/08_trainer_female.png'),
                trainerQuote: String(trainer?.signature || '').trim() || 'Auto chọn kỹ năng thông minh',
                trainerPrize: 'Không có',
                trainerPrizeItem: 'Không có',
                trainerPrizeItemQuantity: 1,
                trainerCoinsReward: 0,
                trainerExpReward: 0,
                trainerMoonPointsReward: 0,
                currentIndex: 0,
                level: leadPokemon.level,
                hp: leadPokemon.maxHp,
                maxHp: leadPokemon.maxHp,
                pokemon: leadPokemon.pokemon,
                team: duelTeam,
                fieldState: {},
            }

            const preparedParty = (Array.isArray(party) ? party : []).map((slot) => {
                if (!slot) return slot
                const maxHp = Math.max(1, Number(slot?.stats?.hp) || 1)
                const refilledMoveData = buildRefilledBattleMoves(slot)
                return {
                    ...slot,
                    moves: refilledMoveData.moves,
                    movePpState: refilledMoveData.movePpState,
                    status: '',
                    statusTurns: 0,
                    statStages: {},
                    damageGuards: {},
                    wasDamagedLastTurn: false,
                    volatileState: {},
                    battleCurrentHp: maxHp,
                    battleMaxHp: maxHp,
                }
            })
            setParty(preparedParty)

            const initialPartyState = buildBattlePartyState(preparedParty)
            const initialIndex = getNextAlivePartyIndex(preparedParty, initialPartyState, -1)

            setBattleResults(null)
            setBattleLog([])
            setActionMessage(`Bạn khiêu chiến đội hình của ${trainerName}.`)
            setSelectedMoveIndex(0)
            setActiveTab('fight')
            setActiveBattleMode('online')
            setShouldResetTrainerSession(false)
            setDuelResultModal(null)
            setOpponent(onlineOpponent)
            setBattleOpponent(onlineOpponent)
            setBattlePlayerIndex(Math.max(0, initialIndex))
            setBattlePartyHpState(initialPartyState)
            setDuelOpponentMoves([])
            setDuelOpponentMoveCursor(0)
            setView('battle')
        } catch (error) {
            setActionMessage(error?.message || 'Không thể bắt đầu trận khiêu chiến online.')
        }
    }

    const handleRematchTrainer = (entry) => {
        const normalizedId = String(entry?.id || '').trim()
        if (!normalizedId) return

        const rematchOpponent = resolveTrainerOpponentById(normalizedId)
        if (!rematchOpponent) {
            setActionMessage('Không tìm thấy dữ liệu huấn luyện viên để đấu lại.')
            return
        }

        setAutoTrainerTargetId(normalizedId)
        writeStoredAutoTrainerTargetId(normalizedId)
        setOpponent(rematchOpponent)
        startBattleWithOpponent(rematchOpponent)
    }

    const selectedAutoTrainerEntry = completedEntries.find(
        (entry) => normalizeEntityId(entry?.id) === normalizeEntityId(autoTrainerTargetId)
    ) || null
    const hasMissingAutoTrainerSelection = Boolean(normalizeEntityId(autoTrainerTargetId)) && !selectedAutoTrainerEntry

    const handleToggleAutoTrainer = async () => {
        try {
            if (autoTrainerAttackEnabled) {
                const res = await gameApi.updateAutoTrainerSettings({
                    enabled: false,
                    trainerId: normalizeEntityId(autoTrainerTargetId),
                    attackIntervalMs: Math.max(450, Number(autoTrainerAttackIntervalMs) || DEFAULT_AUTO_TRAINER_ATTACK_INTERVAL_MS),
                })
                applyAutoTrainerStatus(res?.autoTrainer || {}, { forceConfig: true })
                setActionMessage('Đã tắt auto battle trainer.')
                return
            }

            if (!canUseVipAutoTrainer) {
                setActionMessage('Chỉ tài khoản VIP mới có thể bật auto battle trainer.')
                return
            }

            const normalizedTrainerId = normalizeEntityId(autoTrainerTargetId)
            if (!normalizedTrainerId) {
                setActionMessage('Hãy chọn một trainer đã hoàn thành để bật auto battle.')
                return
            }

            const res = await gameApi.updateAutoTrainerSettings({
                enabled: true,
                trainerId: normalizedTrainerId,
                attackIntervalMs: Math.max(450, Number(autoTrainerAttackIntervalMs) || DEFAULT_AUTO_TRAINER_ATTACK_INTERVAL_MS),
            })
            applyAutoTrainerStatus(res?.autoTrainer || {}, { forceConfig: true })
            setActionMessage(`Đã bật auto battle trainer với ${selectedAutoTrainerEntry?.name || 'trainer đã chọn'}. Auto sẽ chạy ngầm ở server.`)
        } catch (error) {
            setActionMessage(String(error?.message || 'Không thể cập nhật auto battle trainer.'))
        }
    }

    const autoTrainerSelectableEntries = completedEntries
    const hasAutoTrainerTargets = autoTrainerSelectableEntries.length > 0
    const autoTrainerControlPanel = canUseVipAutoTrainer && activeBattleMode === 'trainer' && (
        <div className="border border-slate-300 bg-slate-50 rounded p-3 text-xs text-slate-700 space-y-2 max-w-xl mx-auto w-full">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <div className="font-bold text-slate-800">Auto battle trainer</div>
                    <div className="text-[10px] text-slate-500">Tự vào trận và farm trainer đã hoàn thành theo lựa chọn của bạn.</div>
                </div>
                <button
                    type="button"
                    onClick={handleToggleAutoTrainer}
                    disabled={!hasAutoTrainerTargets}
                    className={`px-3 py-1.5 rounded font-bold border transition-colors ${autoTrainerAttackEnabled
                        ? 'bg-emerald-600 border-emerald-700 text-white hover:bg-emerald-700'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'} disabled:opacity-50`}
                >
                    {autoTrainerAttackEnabled ? 'Đang bật' : 'Bật auto'}
                </button>
            </div>

            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-700">Trainer auto</span>
                <select
                    value={autoTrainerTargetId}
                    onChange={(e) => {
                        const nextTrainerId = normalizeEntityId(e.target.value)
                        markAutoTrainerConfigDirty()
                        setAutoTrainerTargetId(nextTrainerId)
                        writeStoredAutoTrainerTargetId(nextTrainerId)
                    }}
                    disabled={!hasAutoTrainerTargets || autoTrainerAttackEnabled}
                    className="px-2 py-1 border border-slate-300 rounded bg-white text-xs max-w-[230px]"
                >
                    {!hasAutoTrainerTargets && <option value="">Chưa có trainer đã hoàn thành</option>}
                    {hasMissingAutoTrainerSelection && (
                        <option value={autoTrainerTargetId}>Đang giữ trainer đã chọn</option>
                    )}
                    {autoTrainerSelectableEntries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                            {entry.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-700">Tốc độ đánh</span>
                <select
                    value={autoTrainerAttackIntervalMs}
                    onChange={(e) => {
                        const nextValue = Number.parseInt(e.target.value, 10)
                        markAutoTrainerConfigDirty()
                        setAutoTrainerAttackIntervalMs(Number.isFinite(nextValue) ? nextValue : DEFAULT_AUTO_TRAINER_ATTACK_INTERVAL_MS)
                    }}
                    disabled={!canUseVipAutoTrainer}
                    className="px-2 py-1 border border-slate-300 rounded bg-white text-xs"
                >
                    {AUTO_TRAINER_ATTACK_INTERVAL_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            </div>

            <div className="text-[10px] text-slate-500">
                {selectedAutoTrainerEntry
                    ? `Đang chọn: ${selectedAutoTrainerEntry.name}`
                    : 'Chưa chọn trainer auto'}
                {' · '}
                Giới hạn auto battle: {(autoTrainerRuntimeLimitMinutes > 0 ? `${autoTrainerRuntimeLimitMinutes} phút/ngày` : (autoTrainerDurationLimitMinutes > 0 ? `${autoTrainerDurationLimitMinutes} phút/ngày` : 'không giới hạn'))}
                {' · '}
                Lượt chạy hôm nay: {autoTrainerUsageToday}/{autoTrainerUsesPerDayLimit > 0 ? autoTrainerUsesPerDayLimit : '∞'}
                {' · '}
                Đã dùng: {autoTrainerRuntimeTodayMinutes} phút
            </div>

            {autoTrainerServerStatus && (
                <div className="text-[10px] font-semibold text-slate-600">
                    Trạng thái auto ngầm: {autoTrainerServerStatus}
                </div>
            )}

            {autoTrainerServerLogs.length > 0 && (
                <div className="border border-slate-200 rounded bg-white p-2 space-y-1 max-h-24 overflow-y-auto">
                    {autoTrainerServerLogs.slice(0, 4).map((entry) => (
                        <div key={entry._id || entry.id} className={`text-[10px] ${entry.type === 'success'
                            ? 'text-emerald-700'
                            : (entry.type === 'error' ? 'text-rose-700' : (entry.type === 'warn' ? 'text-amber-700' : 'text-slate-600'))}`}>
                            • {formatFriendlyAutoTrainerMessage(entry.message)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )

    const challengeModeReady = isRankedChallengeRequested
        ? activeBattleMode === 'duel'
        : (isOnlineChallengeRequested ? activeBattleMode === 'online' : true)

    if (isExternalChallengeRequested && (loading || isStartingRankedDuel || isStartingOnlineChallenge || !challengeModeReady)) {
        return (
            <div className="max-w-4xl mx-auto py-12">
                <div className="text-center text-slate-500 font-bold animate-pulse">
                    {isOnlineChallengeRequested
                        ? 'Đang vào trận khiêu chiến đội hình online...'
                        : 'Đang vào trận khiêu chiến Pokemon từ BXH...'}
                </div>
            </div>
        )
    }

    if (view === 'battle') {
        return (
            <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto font-sans">
                <div className="text-center space-y-2">
                    <div className="text-slate-600 font-bold text-sm">
                        🪙 {playerState?.platinumCoins ?? 0} Xu Bạch Kim <span className="mx-2">•</span> 🌑 {playerState?.moonPoints ?? 0} Điểm Nguyệt Các
                    </div>
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                        {activeBattleMode === 'duel'
                            ? 'Chế độ: Khiêu chiến BXH'
                            : (activeBattleMode === 'online' ? 'Chế độ: Khiêu chiến online theo đội hình' : 'Chế độ: Battle Trainer')}
                    </div>
                </div>

                {autoTrainerControlPanel}

                <ActiveBattleView
                    party={party}
                    encounter={encounter}
                    playerState={playerState}
                    opponent={battleOpponent || opponent}
                    onAttack={handleAttack}
                    actionMessage={actionMessage}
                    activeTab={activeTab}
                    onSelectTab={setActiveTab}
                    inventory={inventory}
                    onUseItem={handleUseItem}
                    onRun={handleRun}
                    selectedMoveIndex={selectedMoveIndex}
                    onSelectMove={setSelectedMoveIndex}
                    onPlanMove={handlePlanMove}
                    onSwitchParty={handleSwitchParty}
                    battleLog={battleLog}
                    isAttacking={isAttacking}
                    activePartyIndex={battlePlayerIndex}
                    partyHpState={battlePartyHpState}
                    allowAttackSpamClicks={activeBattleMode === 'trainer'}
                    attackButtonOffset={activeBattleMode === 'trainer' ? trainerAttackButtonOffset : { x: 0, y: 0 }}
                />
                {activeBattleMode === 'trainer' && trainerAttackChallenge && (
                    <Modal
                        isOpen
                        onClose={() => {}}
                        title="Xác minh thao tác"
                        maxWidth="sm"
                        showCloseButton={false}
                    >
                        <div className="space-y-4" key={trainerAttackChallenge.id}>
                            <div className="rounded-lg border-2 border-blue-300 bg-blue-50 p-3 text-center">
                                <div className="text-[11px] font-black uppercase tracking-wide text-blue-700">Kiểm tra anti auto click</div>
                                <div className="mt-2 text-sm font-bold text-slate-800">{trainerAttackChallenge.prompt}</div>
                                <div className="mt-1 text-xs text-slate-600">Chọn đáp án đúng để tiếp tục trận đấu.</div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                {trainerAttackChallenge.options.map((option) => (
                                    <button
                                        key={`${trainerAttackChallenge.id}-${option}`}
                                        type="button"
                                        onClick={() => handleTrainerAttackChallengeAnswer(option)}
                                        className="rounded border-2 border-slate-300 bg-white py-2 text-sm font-bold text-slate-800 hover:border-blue-400 hover:bg-blue-50"
                                    >
                                        {option}
                                    </button>
                                ))}
                            </div>

                            {trainerAttackChallengeError && (
                                <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-center text-xs font-bold text-rose-700">
                                    {trainerAttackChallengeError}
                                </div>
                            )}
                        </div>
                    </Modal>
                )}
                {(activeBattleMode === 'duel' || activeBattleMode === 'online') && duelResultModal && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="bg-white border-2 border-slate-300 rounded w-[440px] max-w-[90%] shadow-lg">
                            <div className="text-center font-bold text-sm border-b border-slate-200 py-2">
                                {duelResultModal.title}
                            </div>
                            <div className="p-4 text-center space-y-2">
                                <div className={`text-base font-bold ${duelResultModal.resultType === 'win' ? 'text-emerald-700' : 'text-rose-700'}`}>
                                    {duelResultModal.resultType === 'win' ? 'Chiến thắng!' : 'Thất bại!'}
                                </div>
                                <div className="text-sm text-slate-700">{duelResultModal.message}</div>
                            </div>
                            <div className="border-t border-slate-200 p-3 text-center">
                                <button
                                    onClick={closeRankedDuelResultModal}
                                    className="px-6 py-2 bg-white border border-blue-400 hover:bg-blue-50 text-blue-800 font-bold rounded shadow-sm"
                                >
                                    {resolveDuelReturnLabel(duelReturnPath)}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                {battleResults && (
                    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                        <div className="bg-white border-2 border-slate-300 rounded w-[520px] max-w-[90%] shadow-lg">
                            <div className="text-center font-bold text-sm border-b border-slate-200 py-2">
                                {battleResults?.resultType === 'defeat' ? 'Kết Thúc Trận Đấu' : 'Kết Quả Trận Đấu'}
                            </div>
                            <div className="p-4 text-center text-xs">
                                <div className="mb-2">
                                    {battleResults?.resultType === 'defeat'
                                        ? (battleResults?.message || 'Pokemon của bạn đã bại trận.')
                                        : 'Trận đấu đã kết thúc thành công!'}
                                </div>
                                {battleResults?.resultType === 'defeat' ? (
                                    <div className="border border-rose-200 bg-rose-50 rounded p-3 flex items-center gap-3 justify-center">
                                        {battleResults.pokemon?.imageUrl ? (
                                            <img
                                                src={battleResults.pokemon.imageUrl}
                                                alt={battleResults.pokemon.name}
                                                className="w-10 h-10 object-contain pixelated bg-white rounded border border-rose-200"
                                            />
                                        ) : (
                                            <div className="w-10 h-10 bg-white rounded border border-rose-200" />
                                        )}
                                        <div className="text-left">
                                            <div className="font-bold text-sm text-rose-700">{battleResults.pokemon?.name || 'Pokemon'}</div>
                                            <div className="text-rose-600">Đã kiệt sức</div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {Array.isArray(battleResults.pokemonRewards) && battleResults.pokemonRewards.length > 0 ? (
                                            <div className="space-y-2">
                                                {battleResults.pokemonRewards.map((reward, index) => (
                                                    <div
                                                        key={`${reward.userPokemonId || reward.name || 'pokemon'}-${index}`}
                                                        className="border border-slate-200 rounded p-3 flex items-center gap-3 justify-center"
                                                    >
                                                        {reward.imageUrl ? (
                                                            <img
                                                                src={reward.imageUrl}
                                                                alt={reward.name}
                                                                className="w-10 h-10 object-contain pixelated bg-slate-100 rounded border border-slate-200"
                                                            />
                                                        ) : (
                                                            <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200" />
                                                        )}
                                                        <div className="text-left">
                                                            <div className="font-bold text-sm">{reward.name}</div>
                                                            <div>Hạ gục: {reward.defeatedCount || 0} Pokemon</div>
                                                            <div>+{reward.levelsGained || 0} cấp</div>
                                                            <div>+{reward.happinessGained || 0} Hạnh phúc</div>
                                                            <div className="text-slate-500">
                                                                EXP: {Number.isFinite(Number(reward?.expBefore))
                                                                    ? `${Math.max(0, Number(reward.expBefore))} -> ${reward.exp}`
                                                                    : reward.exp}/{reward.expToNext} (+{reward.finalExp || 0})
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="border border-slate-200 rounded p-3 flex items-center gap-3 justify-center">
                                                {battleResults.pokemon?.imageUrl ? (
                                                    <img
                                                        src={battleResults.pokemon.imageUrl}
                                                        alt={battleResults.pokemon.name}
                                                        className="w-10 h-10 object-contain pixelated bg-slate-100 rounded border border-slate-200"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200" />
                                                )}
                                                <div className="text-left">
                                                    <div className="font-bold text-sm">{battleResults.pokemon.name}</div>
                                                    <div>+{battleResults.pokemon.levelsGained} cấp</div>
                                                    <div>+{battleResults.pokemon.happinessGained} Hạnh phúc</div>
                                                    <div className="text-slate-500">
                                                        EXP: {Number.isFinite(Number(battleResults?.pokemon?.expBefore))
                                                            ? `${Math.max(0, Number(battleResults.pokemon.expBefore))} -> ${battleResults.pokemon.exp}`
                                                            : battleResults.pokemon.exp}/{battleResults.pokemon.expToNext}
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="mt-3 text-sm font-bold text-slate-700">+{battleResults.rewards.coins} Xu</div>
                                        <div className="text-xs text-slate-500">+{battleResults.rewards.trainerExp} EXP Huấn luyện viên</div>
                                        <div className="text-xs text-slate-500">+{battleResults.rewards.moonPoints || 0} Điểm Nguyệt Các</div>
                                        {battleResults.rewards?.prizeItem?.name && (
                                            <div className="text-xs text-blue-600 mt-1">
                                                + Vật phẩm: {battleResults.rewards.prizeItem.name} x{battleResults.rewards.prizeItem.quantity || 1}
                                            </div>
                                        )}
                                        {battleResults.rewards?.prizePokemon?.claimed && (
                                            <div className="text-xs text-emerald-600 mt-1">
                                                + Phần thưởng: {battleResults.rewards.prizePokemon.name}
                                            </div>
                                        )}
                                        {battleResults.rewards?.prizePokemon?.alreadyClaimed && (
                                            <div className="text-xs text-slate-500 mt-1">
                                                {battleResults.rewards.prizePokemon.blockedReason === 'trainer_completed'
                                                    ? `Đã hoàn thành trainer này trước đó, không nhận lại Pokémon thưởng (${battleResults.rewards.prizePokemon.name}).`
                                                    : `Phần thưởng đã nhận: ${battleResults.rewards.prizePokemon.name}`}
                                            </div>
                                        )}
                                        {battleResults.evolution?.evolved && Array.isArray(battleResults.evolution.chain) && battleResults.evolution.chain.length > 0 && (
                                            <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-left">
                                                <div className="text-[11px] font-bold text-emerald-700">Tiến hóa</div>
                                                {battleResults.evolution.chain.map((step, index) => (
                                                    <div key={`${step.fromPokemonId || step.from}-${step.toPokemonId || step.to}-${index}`} className="text-[11px] text-emerald-800">
                                                        {step.from} {'->'} {step.to} (Lv. {step.level})
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="border-t border-slate-200 p-3 text-center">
                                <button
                                    onClick={() => {
                                        setBattleResults(null)
                                        setView('lobby')
                                        setBattleLog([])
                                        setActionMessage('')
                                        setSelectedMoveIndex(0)
                                        setActiveTab('fight')
                                        setBattlePlayerIndex(0)
                                        setBattlePartyHpState([])
                                        loadData()
                                    }}
                                    className="px-6 py-2 bg-white border border-blue-400 hover:bg-blue-50 text-blue-800 font-bold rounded shadow-sm"
                                >
                                    {battleResults?.resultType === 'defeat' ? 'Quay lại' : 'Chiến đấu'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fadeIn max-w-4xl mx-auto font-sans">

            <div className="text-center space-y-2">
                <div className="text-slate-600 font-bold text-sm">
                    🪙 {playerState?.platinumCoins ?? 0} Xu Bạch Kim <span className="mx-2">•</span> 🌑 {playerState?.moonPoints ?? 0} Điểm Nguyệt Các
                </div>
                <h1 className="text-3xl font-extrabold text-blue-900 drop-shadow-sm uppercase tracking-wide">
                    Khu Vực Chiến Đấu
                </h1>
            </div>

            {autoTrainerControlPanel}

            <div className="rounded border border-blue-400 bg-white shadow-sm overflow-hidden">
                <SectionHeader title="Trận Chiến Hiện Tại" />
                <div className="p-6 bg-white flex flex-col items-center text-center">
                    {opponent && (
                        <div className="mb-3 flex flex-col items-center">
                            <img
                                src={opponent.trainerImage}
                                alt={opponent.trainerName}
                                className={activeBattleMode === 'online'
                                    ? 'w-24 h-24 rounded-full object-cover border border-blue-200'
                                    : 'w-24 h-24 object-contain pixelated'}
                                onError={(event) => {
                                    event.currentTarget.onerror = null
                                    event.currentTarget.src = '/assets/08_trainer_female.png'
                                }}
                            />
                            <div className="mt-2">
                                <span className="font-bold text-slate-800">Huấn luyện viên {opponent.trainerName}:</span>
                                <span className="text-slate-600 italic ml-1">"{opponent.trainerQuote}"</span>
                            </div>
                        </div>
                    )}

                    {opponent?.team?.length ? (
                        <button
                            onClick={() => startBattleWithOpponent()}
                            className="text-3xl font-extrabold text-blue-800 hover:text-blue-600 hover:scale-105 transition-transform drop-shadow-sm my-2"
                        >
                            Chiến đấu!
                        </button>
                    ) : (
                        <div className="text-slate-500 text-sm">Không có đội hình huấn luyện viên để chiến đấu.</div>
                    )}

                    <div className="w-full mt-4 border-t border-blue-100"></div>

                    <div className="w-full bg-blue-50/50 py-2 border-b border-blue-100">
                        <div className="text-xs font-bold text-slate-500 uppercase mb-2">Đội Hình Pokémon</div>
                        <div className="flex justify-center gap-8">
                            {(opponent?.team || []).map((poke) => (
                                <div key={poke.id} className="flex flex-col items-center">
                                    {poke.sprite ? (
                                        <img
                                            src={poke.sprite}
                                            className="w-10 h-10 pixelated"
                                        />
                                    ) : (
                                        <div className="w-10 h-10 bg-slate-100 border border-slate-200 rounded" />
                                    )}
                                    <span className="text-[10px] font-bold text-slate-700">L. {poke.level}</span>
                                    {poke.formId && poke.formId !== 'normal' && (
                                        <span className="text-[9px] text-slate-500">{poke.formName || poke.formId}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="w-full py-2">
                        <div className="text-xs font-bold text-slate-500 uppercase">Phần Thưởng</div>
                        {opponent?.team?.length ? (
                            <div className="mt-1 space-y-0.5 text-sm font-bold text-slate-700">
                                <div>Pokémon: {opponent?.trainerPrize || 'Không có'}</div>
                                <div>Item: {opponent?.trainerPrizeItem && opponent?.trainerPrizeItem !== 'Không có' ? `${opponent.trainerPrizeItem} x${opponent?.trainerPrizeItemQuantity || 1}` : 'Không có'}</div>
                                <div>
                                    Xu Bạch Kim: {opponent?.trainerCoinsReward > 0
                                        ? `+${opponent.trainerCoinsReward}`
                                        : 'Theo cấp đội hình'}
                                </div>
                                <div>
                                    EXP huấn luyện viên: {opponent?.trainerExpReward > 0
                                        ? `+${opponent.trainerExpReward}`
                                        : 'Theo cấp đội hình'}
                                </div>
                                <div>
                                    Điểm Nguyệt Các: {opponent?.trainerAutoGenerated
                                        ? 'Không thưởng'
                                        : (opponent?.trainerMoonPointsReward > 0
                                            ? `+${opponent.trainerMoonPointsReward}`
                                            : 'Theo cấp đội hình')}
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm font-bold text-slate-400 mt-1">Không có</div>
                        )}
                    </div>
                </div>
            </div>

            {completedEntries.length > 0 && (
                <>
                    <div className="rounded border border-blue-400 bg-white shadow-sm overflow-visible">
                        <SectionHeader title="Đã Hoàn Thành" />
                        <div className="p-4 sm:p-6 bg-white relative">
                            <div className="flex items-center justify-center gap-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setHoveredCompletedId(null)
                                        setCompletedCarouselIndex((prev) => Math.max(0, prev - 1))
                                    }}
                                    disabled={completedCarouselIndex === 0}
                                    className="w-9 h-9 shrink-0 border border-blue-200 rounded bg-white text-blue-700 font-bold text-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Trang trước"
                                >
                                    {'<'}
                                </button>

                                <div className="w-full max-w-[760px] overflow-hidden">
                                    <div
                                        className="flex transition-transform duration-500 ease-out"
                                        style={{ transform: `translateX(-${completedCarouselIndex * 100}%)` }}
                                    >
                                        {completedSlides.map((slideEntries, slideIndex) => (
                                            <div
                                                key={`completed-slide-${slideIndex}`}
                                                className="w-full shrink-0 flex flex-wrap justify-center gap-4 sm:gap-6 relative min-h-20"
                                            >
                                                {slideEntries.map((entry) => (
                                                    <div
                                                        key={entry.id}
                                                        className="relative z-0 shrink-0 cursor-pointer transition-transform hover:z-40 hover:scale-105"
                                                        onMouseEnter={() => setHoveredCompletedId(entry.id)}
                                                        onMouseLeave={() => setHoveredCompletedId(null)}
                                                        onClick={() => handleRematchTrainer(entry)}
                                                        title={`Đấu lại với ${entry.name}`}
                                                    >
                                                        <img
                                                            src={entry.image}
                                                            className="w-20 h-20 object-contain pixelated"
                                                        />
                                                        {hoveredCompletedId === entry.id && (
                                                            <div className="absolute left-1/2 bottom-full mb-3 w-[320px] max-w-[calc(100vw-2rem)] -translate-x-1/2 bg-white border border-slate-200 rounded shadow-lg p-3 text-xs z-50">
                                                                <div className="font-bold text-slate-700 mb-2">Thông tin</div>
                                                                <div className="flex gap-2 items-start">
                                                                    <img src={entry.image} className="w-12 h-12 object-contain pixelated" />
                                                                    <div>
                                                                        <div className="font-bold">Huấn luyện viên {entry.name}:</div>
                                                                        <div className="italic text-slate-600">"{entry.quote}"</div>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-3 font-bold">Đội hình Pokémon</div>
                                                                <div className="flex gap-4 mt-2">
                                                                    {entry.team.map((poke) => (
                                                                        <div key={poke.id} className="flex flex-col items-center">
                                                                            {poke.sprite ? (
                                                                                <img src={poke.sprite} className="w-8 h-8 pixelated" />
                                                                            ) : (
                                                                                <div className="w-8 h-8 bg-slate-100 border border-slate-200 rounded" />
                                                                            )}
                                                                            <div className="text-[10px] font-bold">L. {poke.level}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <div className="mt-3 font-bold">Phần thưởng Pokémon</div>
                                                                <div>{entry.prize}</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setHoveredCompletedId(null)
                                        setCompletedCarouselIndex((prev) => Math.min(completedSlideCount - 1, prev + 1))
                                    }}
                                    disabled={completedCarouselIndex >= completedSlideCount - 1}
                                    className="w-9 h-9 shrink-0 border border-blue-200 rounded bg-white text-blue-700 font-bold text-lg disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Trang sau"
                                >
                                    {'>'}
                                </button>
                            </div>

                            {completedEntries.length > completedEntriesPerView && (
                                <div className="mt-3 text-center text-xs font-bold text-slate-500">
                                    Trang {completedCarouselIndex + 1}/{completedSlideCount}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="rounded border border-blue-400 bg-blue-100/50 shadow-sm overflow-hidden text-center p-2">
                        <SectionHeader title="Đã Hoàn Thành - Chi Tiết" />
                        <p className="text-xs text-blue-800 mt-2 p-2">
                            Nhấn vào ảnh huấn luyện viên để đấu lại. Rê chuột để xem chi tiết đầy đủ.
                        </p>
                    </div>
                </>
            )}

        </div>
    )
}

export function ExplorePage() {
    return (
        <div className="space-y-3">
            <div className="text-lg font-semibold text-slate-100">Khám phá</div>
            <div className="rounded border border-slate-700 bg-slate-950/40 p-3 text-slate-300">
                <FeatureUnavailableNotice
                    title="Khám phá chưa cập nhật"
                    message="Bản đồ khám phá thời gian thực đang được hoàn thiện cho Phase 2."
                />
            </div>
        </div>
    )
}
