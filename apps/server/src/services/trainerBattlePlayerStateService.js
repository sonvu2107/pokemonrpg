import UserPokemon from '../models/UserPokemon.js'
import { normalizeBattleStatus, normalizeStatusTurns } from '../battle/battleState.js'
import { resolvePlayerBattleMaxHp } from '../utils/playerBattleStats.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const normalizeAbility = (value = '') => String(value || '').trim().toLowerCase()
const normalizeAbilitySuppressed = (value = false) => {
    if (typeof value === 'string') {
        const normalized = String(value || '').trim().toLowerCase()
        return normalized === 'true' || normalized === '1'
    }
    return Boolean(value)
}

const normalizeAbilityPool = (value = []) => {
    const entries = Array.isArray(value) ? value : []
    return [...new Set(entries.map((entry) => normalizeAbility(entry)).filter(Boolean))]
}

const resolvePokemonAbilitySnapshot = ({ entry = null, existingEntry = null } = {}) => {
    const existingAbility = normalizeAbility(existingEntry?.ability)
    if (existingAbility) return existingAbility

    const directAbility = normalizeAbility(entry?.ability)
    if (directAbility) return directAbility

    const legacySpeciesAbility = normalizeAbility(entry?.pokemonId?.ability)
    if (legacySpeciesAbility) return legacySpeciesAbility

    const speciesPool = normalizeAbilityPool(entry?.pokemonId?.abilities)
    if (speciesPool.length > 0) return speciesPool[0]

    return ''
}

const buildPlayerPartyEntryFromPokemon = (entry = {}, slot = 0, existingEntry = null, hpBonusPercent = 0) => {
    const species = entry?.pokemonId || {}
    const level = Math.max(1, Number(entry?.level || 1))
    const calculatedMaxHp = resolvePlayerBattleMaxHp({
        baseHp: Number(species?.baseStats?.hp || 1),
        level,
        rarity: species?.rarity || 'd',
        hpBonusPercent,
    })
    const existingCurrentHp = Number(existingEntry?.currentHp)
    const existingMaxHp = Number(existingEntry?.maxHp)
    const resolvedMaxHp = clamp(
        Number.isFinite(existingMaxHp) && existingMaxHp > 0 ? Math.floor(existingMaxHp) : calculatedMaxHp,
        1,
        calculatedMaxHp
    )
    const resolvedCurrentHp = clamp(
        Number.isFinite(existingCurrentHp) ? Math.floor(existingCurrentHp) : resolvedMaxHp,
        0,
        resolvedMaxHp
    )

    return {
        slot,
        userPokemonId: entry?._id || null,
        name: String(entry?.nickname || species?.name || `Pokemon ${slot + 1}`).trim() || `Pokemon ${slot + 1}`,
        currentHp: resolvedCurrentHp,
        maxHp: resolvedMaxHp,
        status: normalizeBattleStatus(existingEntry?.status),
        statusTurns: normalizeStatusTurns(existingEntry?.statusTurns),
        ability: resolvePokemonAbilitySnapshot({ entry, existingEntry }),
        abilitySuppressed: normalizeAbilitySuppressed(existingEntry?.abilitySuppressed),
    }
}

export const buildTrainerPlayerPartyState = (partyRows = [], existingEntries = [], options = {}) => {
    const hpBonusPercent = Math.max(0, Number(options?.hpBonusPercent) || 0)
    const existingMap = new Map(
        (Array.isArray(existingEntries) ? existingEntries : [])
            .map((entry) => [String(entry?.userPokemonId || ''), entry])
            .filter(([key]) => Boolean(key))
    )

    return (Array.isArray(partyRows) ? partyRows : [])
        .map((entry, index) => buildPlayerPartyEntryFromPokemon(entry, index, existingMap.get(String(entry?._id || '')) || null, hpBonusPercent))
        .filter((entry) => entry?.userPokemonId)
}

export const ensureTrainerSessionPlayerParty = async ({ trainerSession, userId, preferredActivePokemonId = null, preloadedParty = null, hpBonusPercent = 0 } = {}) => {
    if (!trainerSession || !userId) return []

    const partyRows = Array.isArray(preloadedParty)
        ? preloadedParty
        : await UserPokemon.find({
            userId,
            location: 'party',
        })
            .select('_id nickname level pokemonId partyIndex ability')
            .populate('pokemonId', 'name baseStats rarity abilities')
            .sort({ partyIndex: 1, _id: 1 })

    const nextPlayerTeam = buildTrainerPlayerPartyState(partyRows, trainerSession.playerTeam, { hpBonusPercent })
    trainerSession.playerTeam = nextPlayerTeam

    const preferredId = String(preferredActivePokemonId || trainerSession.playerPokemonId || '').trim()
    const preferredEntry = preferredId
        ? nextPlayerTeam.find((entry) => String(entry?.userPokemonId || '') === preferredId)
        : null
    const fallbackEntry = nextPlayerTeam.find((entry) => Number(entry?.currentHp || 0) > 0) || nextPlayerTeam[0] || null
    const activeEntry = preferredEntry || fallbackEntry || null

    if (activeEntry) {
        trainerSession.playerPokemonId = activeEntry.userPokemonId
        trainerSession.playerCurrentHp = Math.max(0, Number(activeEntry.currentHp || 0))
        trainerSession.playerMaxHp = Math.max(1, Number(activeEntry.maxHp || 1))
        trainerSession.playerStatus = normalizeBattleStatus(activeEntry.status)
        trainerSession.playerStatusTurns = normalizeStatusTurns(activeEntry.statusTurns)
        trainerSession.playerAbility = normalizeAbility(activeEntry.ability)
        trainerSession.playerAbilitySuppressed = normalizeAbilitySuppressed(activeEntry.abilitySuppressed)
    }

    return nextPlayerTeam
}

export const syncTrainerSessionActivePlayerToParty = (trainerSession = null) => {
    if (!trainerSession || !Array.isArray(trainerSession.playerTeam)) return null
    const activeId = String(trainerSession.playerPokemonId || '').trim()
    if (!activeId) return null
    const activeEntry = trainerSession.playerTeam.find((entry) => String(entry?.userPokemonId || '') === activeId)
    if (!activeEntry) return null

    activeEntry.currentHp = Math.max(0, Number(trainerSession.playerCurrentHp || 0))
    activeEntry.maxHp = Math.max(1, Number(trainerSession.playerMaxHp || activeEntry.maxHp || 1))
    activeEntry.status = normalizeBattleStatus(trainerSession.playerStatus)
    activeEntry.statusTurns = normalizeStatusTurns(trainerSession.playerStatusTurns)
    activeEntry.ability = normalizeAbility(trainerSession.playerAbility || activeEntry.ability)
    activeEntry.abilitySuppressed = normalizeAbilitySuppressed(trainerSession.playerAbilitySuppressed)
    return activeEntry
}

export const resetTrainerSessionTransientPlayerState = (trainerSession = null) => {
    if (!trainerSession) return
    trainerSession.playerStatStages = {}
    trainerSession.playerDamageGuards = {}
    trainerSession.playerWasDamagedLastTurn = false
    trainerSession.playerVolatileState = {}
}

export const setTrainerSessionActivePlayerByIndex = (trainerSession = null, partyIndex = -1) => {
    if (!trainerSession || !Array.isArray(trainerSession.playerTeam)) return null
    const entry = trainerSession.playerTeam[Math.max(0, Number(partyIndex) || 0)] || null
    if (!entry) return null

    trainerSession.playerPokemonId = entry.userPokemonId
    trainerSession.playerCurrentHp = Math.max(0, Number(entry.currentHp || 0))
    trainerSession.playerMaxHp = Math.max(1, Number(entry.maxHp || 1))
    trainerSession.playerStatus = normalizeBattleStatus(entry.status)
    trainerSession.playerStatusTurns = normalizeStatusTurns(entry.statusTurns)
    trainerSession.playerAbility = normalizeAbility(entry.ability)
    trainerSession.playerAbilitySuppressed = normalizeAbilitySuppressed(entry.abilitySuppressed)
    resetTrainerSessionTransientPlayerState(trainerSession)
    return entry
}

export const resolveNextAliveTrainerPlayerIndex = (trainerSession = null, currentIndex = -1) => {
    const playerTeam = Array.isArray(trainerSession?.playerTeam) ? trainerSession.playerTeam : []
    if (playerTeam.length === 0) return -1

    for (let index = Math.max(0, Number(currentIndex) + 1); index < playerTeam.length; index += 1) {
        if (Number(playerTeam[index]?.currentHp || 0) > 0) return index
    }
    for (let index = 0; index < Math.max(0, Number(currentIndex)); index += 1) {
        if (Number(playerTeam[index]?.currentHp || 0) > 0) return index
    }
    return -1
}

export const resolveTrainerSessionActivePlayerIndex = (trainerSession = null) => {
    const activeId = String(trainerSession?.playerPokemonId || '').trim()
    if (!activeId || !Array.isArray(trainerSession?.playerTeam)) return -1
    return trainerSession.playerTeam.findIndex((entry) => String(entry?.userPokemonId || '') === activeId)
}

export const serializeTrainerPlayerPartyState = (trainerSession = null) => {
    const playerTeam = Array.isArray(trainerSession?.playerTeam) ? trainerSession.playerTeam : []
    const activeIndex = resolveTrainerSessionActivePlayerIndex(trainerSession)
    return {
        activeIndex,
        activePokemonId: trainerSession?.playerPokemonId || null,
        team: playerTeam.map((entry, index) => ({
            slot: Math.max(0, Number(entry?.slot ?? index) || 0),
            userPokemonId: entry?.userPokemonId || null,
            name: String(entry?.name || `Pokemon ${index + 1}`).trim() || `Pokemon ${index + 1}`,
            currentHp: Math.max(0, Number(entry?.currentHp || 0)),
            maxHp: Math.max(1, Number(entry?.maxHp || 1)),
            status: normalizeBattleStatus(entry?.status),
            statusTurns: normalizeStatusTurns(entry?.statusTurns),
            ability: normalizeAbility(entry?.ability),
            abilitySuppressed: normalizeAbilitySuppressed(entry?.abilitySuppressed),
        })),
    }
}

export const clearTrainerSessionActivePlayerAbilitySuppression = (trainerSession = null) => {
    if (!trainerSession) return
    trainerSession.playerAbilitySuppressed = false
    const activeEntry = syncTrainerSessionActivePlayerToParty(trainerSession)
    if (activeEntry) {
        activeEntry.abilitySuppressed = false
    }
}

export const applyTrainerSessionForcedPlayerSwitch = (trainerSession = null) => {
    if (!trainerSession) return null
    clearTrainerSessionActivePlayerAbilitySuppression(trainerSession)
    const currentIndex = resolveTrainerSessionActivePlayerIndex(trainerSession)
    const nextIndex = resolveNextAliveTrainerPlayerIndex(trainerSession, currentIndex)
    if (nextIndex === -1) {
        trainerSession.playerPokemonId = null
        trainerSession.playerCurrentHp = 0
        resetTrainerSessionTransientPlayerState(trainerSession)
        return {
            switched: false,
            nextIndex: -1,
            nextEntry: null,
        }
    }
    const nextEntry = setTrainerSessionActivePlayerByIndex(trainerSession, nextIndex)
    return {
        switched: Boolean(nextEntry),
        nextIndex,
        nextEntry,
    }
}
