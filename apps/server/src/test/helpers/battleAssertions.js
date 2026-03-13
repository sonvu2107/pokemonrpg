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
