/**
 * catchChanceService.js
 *
 * Shared catch-chance logic used by:
 *   - wild catch  (game.js / inventory.js)
 *   - valley catch (valleyService.js)
 *
 * Mode 'wild'   → HP factor applies, flee logic handled by caller
 * Mode 'valley' → No HP factor (Pokémon is at full health by definition),
 *                 no flee — just ball modifier + rarity clamp
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const LOW_HP_CATCH_BONUS_CAP_BY_RARITY = Object.freeze({
    'sss+': 5,
    d: 24,
    c: 22,
    b: 20,
    a: 18,
    s: 14,
    ss: 10,
    sss: 7,
})
export const LOW_HP_CATCH_BONUS_CAP_FALLBACK = 16

/** Minimum / maximum raw catch probability before ball modifier */
export const CATCH_CHANCE_MIN = 0.02
export const CATCH_CHANCE_MAX = 0.99

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * Base catch probability from catchRate + HP ratio.
 * Standard Pokémon formula: (catchRate / 255) * hpFactor
 */
const calcBaseChance = ({ catchRate, hp, maxHp }) => {
    const rate = clamp(catchRate || 45, 1, 255)
    const safeMaxHp = Math.max(1, Number(maxHp) || 1)
    const safeHp = clamp(Number(hp) || safeMaxHp, 0, safeMaxHp)
    const hpFactor = (3 * safeMaxHp - 2 * safeHp) / (3 * safeMaxHp)
    return clamp((rate / 255) * hpFactor, CATCH_CHANCE_MIN, 0.95)
}

/**
 * Low-HP bonus cap (%) keyed by rarity.
 */
const resolveLowHpBonusCapPercent = (rarity = '') => {
    const r = String(rarity || '').trim().toLowerCase()
    const cap = Number(LOW_HP_CATCH_BONUS_CAP_BY_RARITY[r])
    return Number.isFinite(cap) && cap >= 0 ? cap : LOW_HP_CATCH_BONUS_CAP_FALLBACK
}

/**
 * Low-HP bonus as an additive percentage (0–cap).
 * Only meaningful in 'wild' mode.
 */
const calcLowHpBonusPercent = ({ hp, maxHp, rarity }) => {
    const safeMaxHp = Math.max(1, Number(maxHp) || 1)
    const safeHp = clamp(Number(hp) || safeMaxHp, 0, safeMaxHp)
    const missingRatio = (safeMaxHp - safeHp) / safeMaxHp
    return Math.max(0, missingRatio * resolveLowHpBonusCapPercent(rarity))
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculate final catch probability.
 *
 * @param {object} opts
 * @param {number}  opts.catchRate         Pokémon species catchRate (1–255)
 * @param {number}  [opts.hp]              Current HP (only used in 'wild' mode)
 * @param {number}  [opts.maxHp]           Max HP    (only used in 'wild' mode)
 * @param {string}  [opts.rarity]          Pokémon rarity key (d/c/b/a/s/ss/sss/sss+)
 * @param {object}  [opts.ballItem]        Item document with effectType / effectValue
 * @param {number}  [opts.vipSsBonusPct]   VIP SS catch-rate bonus percent (0 if not applicable)
 * @param {'wild'|'valley'} [opts.mode]    Defaults to 'wild'
 *
 * @returns {{ chance: number, lowHpBonusPercent: number, ballLabel: string }}
 */
export const calcCatchChance = ({
    catchRate,
    hp,
    maxHp,
    rarity = 'd',
    ballItem = null,
    vipSsBonusPct = 0,
    mode = 'wild',
}) => {
    const isValley = mode === 'valley'

    // ── 1. Base chance ────────────────────────────────────────────────────────
    // Valley: Pokémon is treated as full HP → hpFactor = 1/3 (same as 100% HP)
    const effectiveHp = isValley ? (maxHp ?? 100) : (hp ?? maxHp ?? 100)
    const effectiveMaxHp = maxHp ?? 100

    const baseChance = calcBaseChance({
        catchRate,
        hp: effectiveHp,
        maxHp: effectiveMaxHp,
    })

    // ── 2. VIP SS bonus ───────────────────────────────────────────────────────
    const pokemonRarity = String(rarity || '').trim().toLowerCase()
    const ssBonusPct = pokemonRarity === 'ss' ? Math.max(0, Number(vipSsBonusPct) || 0) : 0
    const chanceAfterVip = ssBonusPct > 0
        ? clamp(baseChance * (1 + ssBonusPct / 100), CATCH_CHANCE_MIN, 0.95)
        : baseChance

    // ── 3. Low-HP bonus (wild only) ───────────────────────────────────────────
    const lowHpBonusPercent = isValley
        ? 0
        : calcLowHpBonusPercent({ hp: effectiveHp, maxHp: effectiveMaxHp, rarity })

    // ── 4. Ball modifier ──────────────────────────────────────────────────────
    const hasFixedRate =
        ballItem?.effectType === 'catchMultiplier' &&
        Number.isFinite(Number(ballItem.effectValue))

    let chanceBeforeLowHp
    let ballLabel = ballItem?.name || 'Poké Ball'

    if (hasFixedRate) {
        // Fixed-rate ball (e.g. Master Ball): ignore base chance entirely
        chanceBeforeLowHp = clamp(Number(ballItem.effectValue) / 100, 0, 1)
    } else {
        chanceBeforeLowHp = chanceAfterVip
    }

    // ── 5. Apply low-HP bonus ─────────────────────────────────────────────────
    const minChance = hasFixedRate ? 0 : CATCH_CHANCE_MIN
    const chance = clamp(
        chanceBeforeLowHp * (1 + lowHpBonusPercent / 100),
        minChance,
        CATCH_CHANCE_MAX,
    )

    return {
        chance,
        lowHpBonusPercent,
        ballLabel,
    }
}

/**
 * Roll the catch attempt.
 * @returns {boolean}
 */
export const rollCatch = (chance) => Math.random() < chance

/**
 * Qualitative label for UI display (valley hides exact %).
 * @param {number} chance 0–1
 * @returns {'Thấp' | 'Trung bình' | 'Cao' | 'Rất cao'}
 */
export const catchChanceLabel = (chance) => {
    if (chance >= 0.75) return 'Rất cao'
    if (chance >= 0.45) return 'Cao'
    if (chance >= 0.20) return 'Trung bình'
    return 'Thấp'
}
