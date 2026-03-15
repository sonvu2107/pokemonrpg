import assert from 'assert'
import { resolvePlayerBattleMaxHp } from '../../utils/playerBattleStats.js'

export const assertOkResponse = (res, message = 'Expected OK response') => {
    assert.strictEqual(res.statusCode, 200, message)
    assert.strictEqual(Boolean(res.payload?.ok), true, 'Expected payload.ok = true')
}

export const assertSnapshotUnchanged = ({ before, after }, message = 'Expected snapshot to stay immutable') => {
    assert.deepStrictEqual(after, before, message)
}

export const assertPlayerMaxHpFromSnapshot = ({
    actualMaxHp,
    pokemon,
    snapshot,
    message = 'Expected max HP calculated from snapshot',
}) => {
    const expectedMaxHp = resolvePlayerBattleMaxHp({
        baseHp: Number(pokemon?.pokemonId?.baseStats?.hp || 1),
        level: Math.max(1, Number(pokemon?.level || 1)),
        rarity: pokemon?.pokemonId?.rarity || 'd',
        hpBonusPercent: Math.max(0, Number(snapshot?.partyHpPercent || 0)),
    })
    assert.strictEqual(actualMaxHp, expectedMaxHp, message)
    return expectedMaxHp
}

export const assertNoLiveBadgeRead = (counter, message = 'Expected no live badge lookup') => {
    assert.strictEqual(Number(counter || 0), 0, message)
}

export const assertForcedSwitchHazardSequence = ({
    turnPhases = [],
    expectedEntryHazardEventCount = null,
    expectedLogSnippets = [],
    phaseKey = 'forced_switch',
    phaseMessage = 'Expected forced_switch phase',
} = {}) => {
    const phase = Array.isArray(turnPhases)
        ? turnPhases.find((entry) => entry?.key === phaseKey)
        : null

    assert(phase, phaseMessage)

    const events = Array.isArray(phase?.events) ? phase.events : []
    const lines = Array.isArray(phase?.lines) ? phase.lines.map((line) => String(line)) : []
    const forcedSwitchEventIndex = events.findIndex((event) => event?.kind === 'forced_switch')
    const hazardEventIndexes = events
        .map((event, index) => ({ event, index }))
        .filter((entry) => entry?.event?.kind === 'entry_hazard')
        .map((entry) => entry.index)

    assert(forcedSwitchEventIndex >= 0, 'Expected forced_switch event in forced_switch phase')
    assert(hazardEventIndexes.length > 0, 'Expected entry_hazard event in forced_switch phase')
    assert(hazardEventIndexes[0] > forcedSwitchEventIndex, 'Expected entry_hazard logs to appear after forced_switch event')

    if (Number.isInteger(expectedEntryHazardEventCount)) {
        assert.strictEqual(
            hazardEventIndexes.length,
            expectedEntryHazardEventCount,
            `Expected ${expectedEntryHazardEventCount} entry_hazard events in forced_switch phase`
        )
    }

    let previousMatchIndex = -1
    expectedLogSnippets.forEach((snippet) => {
        const matchIndex = lines.findIndex((line, index) => index > previousMatchIndex && line.includes(String(snippet)))
        assert(matchIndex >= 0, `Expected forced_switch lines to contain snippet in order: ${snippet}`)
        previousMatchIndex = matchIndex
    })

    return phase
}
