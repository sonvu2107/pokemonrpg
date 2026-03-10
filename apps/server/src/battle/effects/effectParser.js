const DASH_TOKENS = new Set(['', '-', '--', '---', '—', '–', '_'])

const normalizeText = (value = '') => String(value || '').trim()

const parseProbabilityToChance = (probability) => {
    const raw = normalizeText(probability)
    if (DASH_TOKENS.has(raw.toLowerCase())) return null
    const parsed = Number(raw.replace('%', '').replace(',', '.'))
    if (!Number.isFinite(parsed)) return null
    if (parsed <= 0) return 0
    if (parsed > 100) return 1
    return parsed / 100
}

const withChance = (effect, fallbackChance) => {
    if (effect.chance !== undefined && effect.chance !== null) return effect
    return {
        ...effect,
        chance: fallbackChance ?? 1,
    }
}

const statAlias = {
    attack: 'atk',
    'attack stat': 'atk',
    atk: 'atk',
    defense: 'def',
    'defense stat': 'def',
    defence: 'def',
    'defence stat': 'def',
    def: 'def',
    speed: 'spd',
    'speed stat': 'spd',
    spd: 'spd',
    accuracy: 'acc',
    evasiveness: 'eva',
    evasive: 'eva',
    'special attack': 'spatk',
    'special attack stat': 'spatk',
    'sp attack': 'spatk',
    'sp. attack': 'spatk',
    'sp atk': 'spatk',
    spatk: 'spatk',
    'special defense': 'spdef',
    'special defense stat': 'spdef',
    'special defence': 'spdef',
    'special defence stat': 'spdef',
    'sp defense': 'spdef',
    'sp. defense': 'spdef',
    'sp defence': 'spdef',
    'sp. defence': 'spdef',
    'sp def': 'spdef',
    spdef: 'spdef',
}

const parseStatName = (raw = '') => {
    const normalized = normalizeText(raw)
        .toLowerCase()
        .replace(/\bby\s+(one|two)\s+stage(s)?\b/g, '')
        .replace(/\bby\s+(one|two)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    return statAlias[normalized] || ''
}

const parseStatList = (raw = '') => {
    const normalized = normalizeText(raw)
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, ' ')

    if (!normalized) return []

    const replaced = normalized
        .replace(/special attack/g, 'special_attack')
        .replace(/special defense/g, 'special_defense')
        .replace(/ and /g, ',')
        .replace(/\//g, ',')

    const list = replaced
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => token.replace(/special_attack/g, 'special attack').replace(/special_defense/g, 'special defense'))

    const unique = []
    const seen = new Set()
    list.forEach((token) => {
        const parsed = parseStatName(token)
        if (!parsed || seen.has(parsed)) return
        seen.add(parsed)
        unique.push(parsed)
    })

    return unique
}

const makeEffect = ({
    op,
    trigger = 'on_hit',
    target = 'opponent',
    chance = null,
    params = {},
    sourceText = '',
    parserConfidence = 0.9,
}) => ({
    op,
    trigger,
    target,
    chance,
    params,
    sourceText,
    parserConfidence,
})

const maybePush = (effects, candidate) => {
    if (!candidate || !candidate.op) return
    effects.push(candidate)
}

export const parseMoveEffectText = ({ description = '', probability = null } = {}) => {
    const sourceText = normalizeText(description)
    if (!sourceText) {
        return {
            effectSpecs: [],
            parserWarnings: [],
            parserConfidence: 1,
        }
    }

    const text = sourceText.toLowerCase()
    const chanceFromProb = parseProbabilityToChance(probability)
    const effects = []
    const warnings = []

    if (/high critical hit ratio/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'crit_rate',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { multiplier: 2 },
            sourceText,
            parserConfidence: 0.95,
        }))
    }

    if (/increases critical hit ratio/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'crit_rate',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { multiplier: 2 },
            sourceText,
            parserConfidence: 0.88,
        }))
    }

    if (/always results in a critical hit|always critical/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'always_crit',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            sourceText,
            parserConfidence: 0.95,
        }))
    }

    if (/ignores accuracy and evasiveness|always hits|never misses/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'never_miss',
            trigger: 'before_accuracy_check',
            target: 'self',
            chance: 1,
            sourceText,
            parserConfidence: 0.95,
        }))
    }

    if (/user attacks first|always goes first|attacks first/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'priority_mod',
            trigger: 'on_select_move',
            target: 'self',
            chance: 1,
            params: { delta: 1 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/\bz-move\b/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'z_move_flavor' },
            sourceText,
            parserConfidence: 0.99,
        }))
    }

    if (/\bg-max move\b/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'gmax_move_flavor' },
            sourceText,
            parserConfidence: 0.96,
        }))
    }

    if (/\bdynamax move\b/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'dynamax_move_flavor' },
            sourceText,
            parserConfidence: 0.96,
        }))
    }

    if (/hits 2-5 times in one turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'multi_hit',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { minHits: 2, maxHits: 5 },
            sourceText,
            parserConfidence: 0.95,
        }))
    } else if (/hits twice in one turn|attacks twice/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'multi_hit',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { minHits: 2, maxHits: 2 },
            sourceText,
            parserConfidence: 0.95,
        }))
    } else if (/target is hit twice in a row/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'multi_hit',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { minHits: 2, maxHits: 2 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/power doubles if opponent already took damage in the same turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_was_damaged_last_turn',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/power doubles if user took damage first/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_was_damaged_last_turn',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/damage doubles if target is dynamaxed/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_is_dynamaxed',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/damage doubles if opponent is dynamaxed/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_is_dynamaxed',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.76,
        }))
    }

    if (/if the user attacks before the target, the power of this move is doubled/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_acts_first',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/power doubles if opponent's hp is less than 50%/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_hp_below_half',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.85,
        }))
    }

    if (/boosted even more if it's super-effective/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'is_super_effective',
                multiplier: 1.33,
            },
            sourceText,
            parserConfidence: 0.75,
        }))
    }

    if (/deals more damage to the opponent that last inflicted damage on it/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_was_damaged_last_turn',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/more powerful when opponent has higher hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_hp_ratio_higher_than_user',
                multiplier: 1.5,
            },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/power doubles if user is burned, poisoned, or paralyzed/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_has_status_ailment',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/inflicts (more|double) damage if the target has a status condition/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_has_status_ailment',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.86,
        }))
    }

    if (/the lower the user's hp, the higher the power/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_by_user_hp',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'lower' },
            sourceText,
            parserConfidence: 0.64,
        }))
    }

    if (/stronger when the user's hp is higher|the higher the user's hp, the higher the power|the higher the user's hp, the higher the damage caused/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_by_user_hp',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'higher' },
            sourceText,
            parserConfidence: 0.64,
        }))
    }

    if (/the higher the opponent's hp, the higher the damage/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_by_target_hp',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'higher' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/power increases with higher friendship/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_random',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                minMultiplier: 1,
                maxMultiplier: 2,
            },
            sourceText,
            parserConfidence: 0.58,
        }))
    }

    if (/double power if the opponent is switching out/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_random',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { multiplier: 2 },
            sourceText,
            parserConfidence: 0.56,
        }))
    }

    if (/may deal double damage/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_random',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: chanceFromProb ?? 0.5,
            params: { multiplier: 2 },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/the higher the user's defense, the stronger the attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'use_defense_as_attack',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/cannot be used twice in a row/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'prevent_repeat_move',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/breaks through reflect and light screen barriers/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_damage_guards',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.85,
        }))
    }

    if (/gives target priority in the next turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'next_turn_priority_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/high priority during grassy terrain/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'priority_mod_if',
            trigger: 'on_select_move',
            target: 'self',
            chance: 1,
            params: {
                condition: 'terrain_grassy',
                delta: 1,
            },
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/user switches with opposite teammate/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'ally_switch_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/user switches out and gives stat changes to the incoming pok[eé]mon/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'switch_pass_stats_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/switches out and summons a snowstorm lasting 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'switch_weather_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/summons gravity for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'gravity_field_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/prevents moves like fly and bounce and the ability levitate for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'gravity_grounding_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/restores the target's hp by up to half of its max hp\. it restores more hp when the terrain is grass/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.74,
        }))
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp_if',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                condition: 'terrain_grassy',
                fraction: 2 / 3,
            },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/sharply raises defense of all grass-type pok[eé]mon on the field/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'fieldwide_grass_defense_boost_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/after making its attack, the user rushes back to switch places with a party pok[eé]mon in waiting/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'self_switch_after_attack_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/changes the abilities of the user and its teammates to that of the target/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'ability_copy_team_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/makes target's ability same as user's/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'ability_swap_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/the user uses its body like a hammer to attack the target and inflict damage/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'flavor_damage_text' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/the user fiercely attacks the target using its entire body/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'flavor_damage_text' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/the slower the user, the stronger the attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_by_speed_relation',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'slower' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/the heavier the opponent, the stronger the attack|the heavier the user, the stronger the attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_by_target_hp',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'higher' },
            sourceText,
            parserConfidence: 0.6,
        }))
    }

    if (/may also injure nearby pok[eé]mon/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'nearby_splash_damage_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/changes user's type to that of its first move/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'self_type_from_first_move_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/changes type to become resistant to opponent's last move/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'self_type_resist_last_move_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/in battles, the opponent switches|opponent switches\./.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'forced_switch_single_battle_flavor' },
            sourceText,
            parserConfidence: 0.65,
        }))
    }

    if (/hits all adjacent pok[eé]mon|hits all adjacent pokemon|hits all adjacent opponents/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'single_battle_multi_target_flavor' },
            sourceText,
            parserConfidence: 0.75,
        }))
    }

    if (/the user swings its body around violently to inflict damage on everything in its vicinity/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'aoe_damage_flavor' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/if the user faints, the opponent also faints/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'destiny_bond_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/the user attacks by sending a frightful amount of small ghosts at opposing pok[eé]mon/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'aoe_damage_flavor' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/the user attacks by hurling a blizzard-cloaked icicle lance at opposing pok[eé]mon/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'flavor_damage_text' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/suppresses the target's ability if the target has already moved/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'ability_suppression_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/cancels out the effect of the opponent's ability|ignores (the )?target's ability/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'ignore_or_cancel_ability_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/swaps the effects on either side of the field/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'field_effect_swap_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/when hit by a physical attack, user strikes back with 2x power/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_was_damaged_last_turn',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/when hit by a special attack, user strikes back with 2x power/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_was_damaged_last_turn',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/inflicts damage based on the target's defense, not special defense/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'use_target_defense_for_special',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/attacks from opposing pok[eé]mon during the next turn cannot miss and will inflict double damage/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'next_turn_vulnerability_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/damage occurs 2 turns later/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'delayed_damage_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/always inflicts 40 hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'fixed_damage_value',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { value: 40 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/power is doubled if opponent is underground from using dig/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { reason: 'target_state_underground_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/power increases each turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_random',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                minMultiplier: 1,
                maxMultiplier: 2,
            },
            sourceText,
            parserConfidence: 0.62,
        }))
    }

    if (/doubles in power each turn for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_random',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                minMultiplier: 1,
                maxMultiplier: 2,
            },
            sourceText,
            parserConfidence: 0.62,
        }))
    }

    if (/deals damage and reduces opponent's pp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'pp_reduction_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/if the users faints after using this move, the pp for the opponent's last move is depleted/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'on_faint_pp_deplete_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/doubles prize money from trainer battles/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'economy_effect_unsupported' },
            sourceText,
            parserConfidence: 0.75,
        }))
    }

    if (/reduces opponent's pp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'pp_reduction_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/changes the target's move to electric type/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'target_move_type_change_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/changes target's type to psychic/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'target_type_change_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/the faster the user, the stronger the attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_by_speed_relation',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { mode: 'faster' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/opponent cannot use items/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'item_usage_block_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/infatuates opponents|makes opponents drowsy/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'infatuation_or_drowsy_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/forces opponent to keep using its last move for 3 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'encore_lock_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/prevents the opponent from restoring hp for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_heal_block',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { turns: 5 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/prevents opponents using the same move twice in a row/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'opponent_repeat_lock_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/strikes through max guard and protect/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'ignore_damage_guards',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/can strike through protect\/detect/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'ignore_damage_guards',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.84,
        }))
    }

    if (/reduces opponent's hp to same as user's/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'equalize_hp_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/always left with at least 1 hp, but may fail if used consecutively/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'endure_stall_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/making direct contact with the pok[eé]mon while it's heating up its beak results in a burn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'contact_burn_preheat_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/increases power and hits all opponents on psychic terrain/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'terrain_psychic',
                multiplier: 1.5,
            },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/added effects appear if combined with grass pledge or water pledge|added effects appear if preceded by water pledge or succeeded by fire pledge|added effects appear if preceded by fire pledge or succeeded by grass pledge/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'pledge_combo_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/protects the user's team from high-priority moves/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'team_priority_shield_or_hit_count_scaling_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/the more times the user has been hit by attacks, the greater the move's power/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_was_damaged_last_turn',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/power depends on held item/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { reason: 'held_item_power_scale_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/deals fighting and flying type damage/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'dual_type_damage_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/user performs a move known by its allies at random/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'ally_move_random_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/copies opponent's last move/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'copy_last_move_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/each pok[eé]mon in user's party attacks/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'party_attack_unsupported' },
            sourceText,
            parserConfidence: 0.65,
        }))
    }

    if (/changes type based on [a-z\-']+ mode/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'dynamic_type_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/changes user's type according to the location|changes user'?s type according to the location/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'location_type_change_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/opponent cannot flee or switch|target becomes unable to flee|unable to flee/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'escape_lock_single_battle_flavor' },
            sourceText,
            parserConfidence: 0.65,
        }))
    }

    if (/prevents (the )?opponent from switching out/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'switch_lock_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/removes battlefield hazards/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'remove_hazards_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/removes opponent's items|opponent's item is stolen by the user|removes opponent's held item for the rest of the battle/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'item_manipulation_flavor' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/protects the pok[eé]mon from status moves/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'protect_status_or_stall_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/protects the user, but may fail if used consecutively|status category dynamax move\. protects the user|protects the user\.?$/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'all',
                multiplier: 0,
                turns: 1,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/in double battle, the user takes all the attacks/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'double_battle_redirect_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/if the user is hit before attacking, it flinches instead/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'focus_punch_prehit_interrupt_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/only hits if opponent uses protect or detect in the same turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'anti_protect_condition_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/opponent can't use its last attack for a few turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'disable_last_move_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/resets opponent's evasiveness, and allows normal- and fighting-type attacks to hit ghosts/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage_set',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { stat: 'eva', stage: 0 },
            sourceText,
            parserConfidence: 0.78,
        }))
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'normal_fighting_hit_ghost_override_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/resets all stat changes/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_stat_stages',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
        maybePush(effects, makeEffect({
            op: 'clear_stat_stages',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/prevents fleeing in the next turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'delayed_escape_lock_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/must have consumed a berry/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'berry_requirement_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/heals status conditions of user's team|restores team's hp and cures status conditions/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_status',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/gives the user's held item to the target/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'item_transfer_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/receives the effect from the opponent's held berry/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'steal_berry_effect_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/takes damage for two turns then strikes back double/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'bide_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/charges on first turn, attacks on second/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'require_recharge',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.66,
        }))
    }

    if (/on first turn, attacks on second/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'require_recharge',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.64,
        }))
    }

    if (/will no longer be [a-z]+ type/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'self_type_change_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/adds grass type to opponent/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'add_type_to_target_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/uses the opponent's attack stat/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'use_target_attack_as_attack',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/user faints\.?/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'self_faint',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/user can['’]t move on the next turn|user can't move on the next turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'require_recharge',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.85,
        }))
    }

    if (/it only works the first turn the user is in battle/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'first_turn_only_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/power decreases with higher friendship/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { reason: 'friendship_power_scale_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/power increases if fusion flare is used in the same turn|power increases if fusion bolt is used in the same turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { reason: 'fusion_combo_turn_condition_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/damages non-water types for 4 turns|damages non-fire types for 4 turns|damages non-grass types for 4 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'end_turn',
            target: 'opponent',
            chance: 1,
            params: { reason: 'gmax_type_filtered_dot_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/non-ice types are damaged for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_weather',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { weather: 'hail', turns: 5 },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/deals damage for 4 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_bind',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {
                minTurns: 4,
                maxTurns: 4,
                fraction: 1 / 16,
            },
            sourceText,
            parserConfidence: 0.64,
        }))
    }

    if (/traps opponents for 4-5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_bind',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: {
                minTurns: 4,
                maxTurns: 5,
                fraction: 1 / 16,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/sets up stealth rock/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'hazard_stealth_rock_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/heals the user's team/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.6,
        }))
    }

    if (/restores half the target's max hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.84,
        }))
    }

    if (/heals the user's party's status conditions/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_status',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.75,
        }))
    }

    if (/stat changes are swapped with the opponent/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'swap_all_stat_stages_with_target',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/user and opponent swap defense and special defense/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'swap_def_spdef_stages_with_target',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/averages defense and special defense with the target/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'average_def_spdef_stages_with_target',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/harshly lowers opponents' speed/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: {
                stat: 'spd',
                delta: -2,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/reduces damage for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'all',
                multiplier: 0.5,
                turns: 5,
            },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/restores a little hp of all pok[eé]mon for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_terrain',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { terrain: 'grassy', turns: 5 },
            sourceText,
            parserConfidence: 0.76,
        }))
    }

    if (/the user engages its gears to raise the attack and sp\. atk stats of ally pok[eé]mon with the plus or minus ability/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'ally_ability_condition_buff_unsupported' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/charges on first turn, sharply raises user's sp\. attack, sp\. defense and speed on the second/.test(text)) {
        ;['spatk', 'spdef', 'spd'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: 1,
                params: { stat, delta: 2 },
                sourceText,
                parserConfidence: 0.74,
            }))
        })
        maybePush(effects, makeEffect({
            op: 'require_recharge',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.64,
        }))
    }

    if (/always leaves opponent with at least 1 hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'enforce_target_survive',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { minHp: 1 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/one-hit-ko, if it hits/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'force_target_ko',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.85,
        }))
    }

    if (/drastically raises user['’]s attack if target is ko['’]d/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage_if',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_was_ko',
                stat: 'atk',
                delta: 3,
            },
            sourceText,
            parserConfidence: 0.83,
        }))
    }

    if (/inflicts damage equal to the user's remaining hp\. user faints/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_damage_to_user_current_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.86,
        }))
        maybePush(effects, makeEffect({
            op: 'self_faint',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.86,
        }))
    }

    if (/lowers hp but sharply boosts attack, special attack, and speed/.test(text)) {
        ;['atk', 'spatk', 'spd'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: 1,
                params: { stat, delta: 2 },
                sourceText,
                parserConfidence: 0.82,
            }))
        })
        maybePush(effects, makeEffect({
            op: 'hp_fraction_cost_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.76,
        }))
    }

    if (/no battle effect/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'explicit_no_battle_effect' },
            sourceText,
            parserConfidence: 0.99,
        }))
    }

    if (/sharply lowers opponent's special attack if opposite gender/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'gender_condition_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/stronger when the user does not have a held item/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_has_no_held_item',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/user recovers half the hp inflicted/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_damage',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.98,
        }))
    } else if (/user recovers most/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_damage',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: { fraction: 0.75 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/user recovers half its max hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.92,
        }))
    }

    if (/restores a little hp each turn|recovers a little hp every turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'end_turn',
            target: 'self',
            chance: 1,
            params: { fraction: 1 / 16 },
            sourceText,
            parserConfidence: 0.85,
        }))
    }

    if (/user restores hp each turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'end_turn',
            target: 'self',
            chance: 1,
            params: { fraction: 1 / 16 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/halves damage from physical and special attacks for five turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'all',
                multiplier: 0.5,
                turns: 5,
            },
            sourceText,
            parserConfidence: 0.92,
        }))
    }

    if (/reduces damage from physical attacks/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'physical',
                multiplier: 0.5,
                turns: 5,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/reduces damage from special attacks/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'special',
                multiplier: 0.5,
                turns: 5,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/halves damage from special attacks for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'special',
                multiplier: 0.5,
                turns: 5,
            },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/recoil damage/.test(text)) {
        let recoilFraction = 0.25
        if (/1\s*\/\s*2/.test(text) || /half the damage/.test(text)) {
            recoilFraction = 0.5
        } else if (/1\s*\/\s*3|one third/.test(text)) {
            recoilFraction = 1 / 3
        } else if (/1\s*\/\s*4|one fourth|a quarter/.test(text)) {
            recoilFraction = 0.25
        }

        maybePush(effects, makeEffect({
            op: 'recoil_fraction_damage',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: { fraction: recoilFraction },
            sourceText,
            parserConfidence: 0.83,
        }))
    }

    if (/user must recharge next turn|must recharge next turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'require_recharge',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/traps opponent, damaging them for 4-5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_bind',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {
                minTurns: 4,
                maxTurns: 5,
                fraction: 1 / 16,
            },
            sourceText,
            parserConfidence: 0.85,
        }))
    }

    if (/removes all of the target's stat changes/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_stat_stages',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.88,
        }))
    }

    if (/ignores opponent's stat changes|ignores target's stat changes/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'ignore_target_stat_stages',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.86,
        }))
    }

    if (/raises all user's stats but loses hp/.test(text)) {
        ;['atk', 'def', 'spatk', 'spdef', 'spd'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: chanceFromProb ?? 1,
                params: { stat, delta: 1 },
                sourceText,
                parserConfidence: 0.83,
            }))
        })

        maybePush(effects, makeEffect({
            op: 'hp_fraction_cost_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: chanceFromProb ?? 1,
            params: { fraction: 1 / 3 },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/boosts attack and defense of a teammate/.test(text)) {
        ;['atk', 'def'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: 1,
                params: { stat, delta: 1 },
                sourceText,
                parserConfidence: 0.62,
            }))
        })
    }

    if (/sets up spikes/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'hazard_spikes_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/raises user's special defense and next electric move's power increases/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { stat: 'spdef', delta: 1 },
            sourceText,
            parserConfidence: 0.82,
        }))

        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'next_electric_boost_pending_unsupported' },
            sourceText,
            parserConfidence: 0.65,
        }))
    }

    if (/hits multiple opponents and lowers their attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: {
                stat: 'atk',
                delta: -1,
            },
            sourceText,
            parserConfidence: 0.86,
        }))
    }

    if (/burns any that have had their stats boosted/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_status_if',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: {
                condition: 'target_has_stat_boost',
                status: 'burn',
            },
            sourceText,
            parserConfidence: 0.83,
        }))
    }

    if (/also lowers the target's defense stat/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: {
                stat: 'def',
                delta: -1,
            },
            sourceText,
            parserConfidence: 0.88,
        }))
    }

    if (/reduces opponents' evasiveness/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: {
                stat: 'eva',
                delta: -1,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/loses 50% of its max hp, but attack raises to maximum/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'hp_fraction_cost_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.9,
        }))

        maybePush(effects, makeEffect({
            op: 'stat_stage_set',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { stat: 'atk', stage: 6 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/cures all status problems in your party/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_status',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/cures all status problems in the party pok[eé]mon/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_status',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/raises special defense of an ally/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { stat: 'spdef', delta: 1 },
            sourceText,
            parserConfidence: 0.65,
        }))
    }

    if (/if opponent is the opposite gender, it's less likely to attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_status',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { status: 'confuse', turns: 2 },
            sourceText,
            parserConfidence: 0.55,
        }))
    }

    if (/if it misses, the user loses half (their|its) hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'crash_damage_on_miss_fraction_max_hp',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/hits pok[eé]mon using fly\/bounce\/sky drop with double power/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { reason: 'target_state_fly_bounce_skydrop_unsupported' },
            sourceText,
            parserConfidence: 0.74,
        }))
    }

    if (/power increases in harsh sunlight/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'weather_sunny',
                multiplier: 1.5,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/makes it rain for 5 turns|summons heavy rain/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_weather',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { weather: 'rain', turns: 5 },
            sourceText,
            parserConfidence: 0.88,
        }))
    }

    if (/makes it sunny for 5 turns|summons harsh sunlight/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_weather',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { weather: 'sun', turns: 5 },
            sourceText,
            parserConfidence: 0.88,
        }))
    }

    if (/creates a sandstorm for 5 turns|summons a sandstorm/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_weather',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { weather: 'sandstorm', turns: 5 },
            sourceText,
            parserConfidence: 0.88,
        }))
    }

    if (/summons hail/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_weather',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { weather: 'hail', turns: 5 },
            sourceText,
            parserConfidence: 0.84,
        }))
    }

    if (/summons electric terrain/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_terrain',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { terrain: 'electric', turns: 5 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/summons psychic terrain|prevents priority moves from being used for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_terrain',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { terrain: 'psychic', turns: 5 },
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/summons grassy terrain/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_terrain',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { terrain: 'grassy', turns: 5 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/summons misty terrain|protects the field from status conditions for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_terrain',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { terrain: 'misty', turns: 5 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/power doubles on electric terrain/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'terrain_electric',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/power increases on electric terrain/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'terrain_electric',
                multiplier: 1.5,
            },
            sourceText,
            parserConfidence: 0.84,
        }))
    }

    if (/power increases on misty terrain/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'terrain_misty',
                multiplier: 1.5,
            },
            sourceText,
            parserConfidence: 0.84,
        }))
    }

    if (/removes effects of terrain/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_terrain',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/in double battles, boosts the power of the partner's move|raises attack of allies|makes the user and an ally very happy/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'double_battle_or_ally_flavor' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/opponent is unable to use moves that the user also knows|type and power depends on user's ivs|destroys the target's held berry/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'double_battle_or_item_or_lock_unsupported' },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/switches attack and defense stats|user's own attack and defense switch/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'swap_user_attack_defense_stages',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/averages attack and special attack with the target/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'average_attack_spatk_stages_with_target',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/boosts attack\/defense\/speed depending on ally tatsugiri|deals damage to opponent or restores hp of teammate|forces attacks to hit user, not team-mates|power increases if teammates use it in the same turn|the user shines a spotlight on the target so that only the target will be attacked during the turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'single_battle_ally_condition_flavor' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/uses a certain move based on the current terrain|either deals damage or heals|inflicts double damage if a teammate fainted on the last turn|effects of the attack vary with the location|fails if the target doesn’t have an item|hits any pok[eé]mon that shares a type with the user/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'advanced_contextual_flavor' },
            sourceText,
            parserConfidence: 0.66,
        }))
    }

    if (/lowers opponent's speed each turn for 3 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { stat: 'spd', delta: -1 },
            sourceText,
            parserConfidence: 0.62,
        }))
    }

    if (/doubles speed for 4 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { stat: 'spd', delta: 2 },
            sourceText,
            parserConfidence: 0.62,
        }))
    }

    if (/uses hp to creates a decoy that takes hits|creates a substitute, then swaps places with a party pok[eé]mon in waiting/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'hp_fraction_cost_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.25 },
            sourceText,
            parserConfidence: 0.62,
        }))
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'all',
                multiplier: 0,
                turns: 1,
            },
            sourceText,
            parserConfidence: 0.58,
        }))
    }

    if (/user and opponent swap attack and special attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'swap_attack_spatk_stages_with_target',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/damages pok[eé]mon using fire type moves/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_status',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { status: 'burn' },
            sourceText,
            parserConfidence: 0.52,
        }))
    }

    if (/the opponent's last move loses 2-5 pp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_status_move_block',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.56,
        }))
    }

    if (/boosts user's stats in incarnate forme, or lowers opponent's stats in therian forme/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage_random',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                delta: 1,
                stats: ['atk', 'def', 'spatk', 'spdef', 'spd'],
            },
            sourceText,
            parserConfidence: 0.54,
        }))
    }

    if (/any pok[eé]mon in play when this attack is used faints in 3 turns|steals the effects of the opponent's next move|swaps every pok[eé]mon's defense and special defense for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'advanced_battle_rule_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/transfers user's status condition to the opponent/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'transfer_status_to_target',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.86,
        }))
    }

    if (/power increases when player's bond is stronger/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { reason: 'friendship_or_bond_scaled_power_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/may raise all stats of user at once/.test(text)) {
        ;['atk', 'def', 'spatk', 'spdef', 'spd'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: chanceFromProb ?? 0.1,
                params: { stat, delta: 1 },
                sourceText,
                parserConfidence: 0.86,
            }))
        })
    }

    if (/lowers opponent's sp\. attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: { stat: 'spatk', delta: -1 },
            sourceText,
            parserConfidence: 0.84,
        }))
    }

    if (/halves damage from physical attacks for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'physical',
                multiplier: 0.5,
                turns: 5,
            },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/user recovers half of its max hp and loses the flying type temporarily/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.9,
        }))
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'temporary_type_loss_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/deals more damage to opponent if hit by a physical move/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_was_damaged_last_turn',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.74,
        }))
    }

    if (/the user regains up to half of its max hp\. it restores more hp in a sandstorm/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.86,
        }))
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp_if',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                condition: 'weather_sandstorm',
                fraction: 2 / 3,
            },
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/heals user's status conditions and raises its stats/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_status',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'unspecified_stat_boost_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/ignores opponent's evasiveness for three turns, add ground immunity/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage_set',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { stat: 'eva', stage: 0 },
            sourceText,
            parserConfidence: 0.78,
        }))
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'ground_immunity_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/adds ghost type to opponent/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'add_type_to_target_unsupported' },
            sourceText,
            parserConfidence: 0.76,
        }))
    }

    if (/resets opponent's evasiveness, removes dark's psychic immunity/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage_set',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { stat: 'eva', stage: 0 },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/raises the team's speed/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: chanceFromProb ?? 1,
            params: { stat: 'spd', delta: 1 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/increases the team's attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: chanceFromProb ?? 1,
            params: { stat: 'atk', delta: 1 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/increases the team's special attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: chanceFromProb ?? 1,
            params: { stat: 'spatk', delta: 1 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/increases the team's special defense/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: chanceFromProb ?? 1,
            params: { stat: 'spdef', delta: 1 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/raises the team's defense/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: chanceFromProb ?? 1,
            params: { stat: 'def', delta: 1 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/uses attack or special attack stat, whichever is higher/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'use_higher_offense_stat',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/user's stats cannot be changed for a period of time/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_stat_drop_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 5 },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/the user's party is protected from status conditions/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_status_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 5 },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/raises attack and special attack of grass-types/.test(text)) {
        ;['atk', 'spatk'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: chanceFromProb ?? 1,
                params: { stat, delta: 1 },
                sourceText,
                parserConfidence: 0.76,
            }))
        })
    }

    if (/user's next attack is guaranteed to result in a critical hit/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_next_attack_always_crit',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/user's next attack is guaranteed to hit/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_next_attack_never_miss',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/heals user's status conditions and recovers hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_status',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.25 },
            sourceText,
            parserConfidence: 0.74,
        }))
    }

    if (/drains hp from opponent each turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_bind',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {
                minTurns: 4,
                maxTurns: 4,
                fraction: 1 / 16,
            },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/deals damage each turn; steel and water types are more affected/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_bind',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {
                minTurns: 4,
                maxTurns: 4,
                fraction: 1 / 8,
            },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/raises defense of ice types for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'physical',
                multiplier: 2 / 3,
                turns: 5,
            },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/protects the user and lowers opponent's attack on contact/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'all',
                multiplier: 0,
                turns: 1,
            },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/user and teammates recover hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.25 },
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/opponent cannot land critical hits for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_crit_block',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 5 },
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/changes normal-type moves to electric-type( moves)?/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_normal_moves_become_electric',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/hits with random power/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_random',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                minMultiplier: 0.5,
                maxMultiplier: 1.5,
            },
            sourceText,
            parserConfidence: 0.66,
        }))
    }

    if (/protects teammates from damaging moves|protects the user's team from multi-target attacks/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'all',
                multiplier: 0,
                turns: 1,
            },
            sourceText,
            parserConfidence: 0.62,
        }))
    }

    if (/suppresses the effects of held items for five turns|user becomes immune to ground-type moves for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'field_or_teamwide_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/reflects moves that cause status conditions back to the attacker/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_status_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/strikes opponent with leaves/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'flavor_damage_text' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/double power if stats were lowered during the turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_has_stat_drop',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/allows an ally to use a move instead|prevents user and opponent from switching out|type depends on the arceus plate being held|can only be used after all other moves are used|damages increases the more party pok[eé]mon have been defeated/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'special_mechanic_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/copies the opponent's stat changes|copies the target's stat changes/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'copy_target_stat_stages',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    if (/the user exchanges speed stats with the target/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'swap_speed_stages_with_target',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/reverses stat changes of opponent/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'invert_target_stat_stages',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/user copies the opponent's attack with 1\.5|deals damage equal to 1\.5x opponent's attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'use_target_attack_as_attack',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.66,
        }))
        maybePush(effects, makeEffect({
            op: 'power_modifier_random',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { multiplier: 1.5 },
            sourceText,
            parserConfidence: 0.66,
        }))
    }

    if (/user copies the opponent's ability|the user swaps abilities with the opponent|copies the opponent's last move|user performs the opponent's last move|permanently copies the opponent's last move/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'copy_or_transform_contextual_flavor' },
            sourceText,
            parserConfidence: 0.66,
        }))
    }

    if (/user performs almost any move in the game at random|user takes on the form and attacks of the opponent/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'copy_or_transform_mechanic_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/user gathers space power and boosts its sp\. atk stat, then attacks the target on the next turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { stat: 'spatk', delta: 1 },
            sourceText,
            parserConfidence: 0.74,
        }))
        maybePush(effects, makeEffect({
            op: 'require_recharge',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.62,
        }))
    }

    if (/attacks for 2-3 turns but then becomes confused|user attacks for 2-3 turns but then becomes confused/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'require_recharge',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.56,
        }))
    }

    if (/takes opponent into the air on first turn, drops them on second turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'require_recharge',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { turns: 1 },
            sourceText,
            parserConfidence: 0.58,
        }))
    }

    if (/weakens the power of electric-type moves|weakens the power of fire-type moves/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'weather_or_terrain_control_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/damages opponents switching into battle|lowers opponent's speed when switching into battle|removes the effects of entry hazards and substitute/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'entry_hazard_single_battle_flavor' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/removes entry hazards and trap move effects, and poisons opposing pok[eé]mon/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_status',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { status: 'poison' },
            sourceText,
            parserConfidence: 0.82,
        }))
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'remove_hazards_or_trap_effect_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/always takes off half of the opponent's hp|halves the opponent's hp|halves the foe's hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_fraction_target_current_hp',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/inflicts damage equal to user's level/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'fixed_damage_from_user_level',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.88,
        }))
    }

    const fixedDamageMatch = text.match(/always inflicts\s+(\d+)\s*hp/)
    if (fixedDamageMatch) {
        maybePush(effects, makeEffect({
            op: 'fixed_damage_value',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { value: Math.max(1, Number(fixedDamageMatch[1])) },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/the user's and opponent's hp becomes the average of both|inflicts damage 50-150% of user's level/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'fixed_or_fractional_hp_damage_unsupported' },
            sourceText,
            parserConfidence: 0.74,
        }))
    }

    if (/user recovers hp\. amount varies with the weather|the user recovers hp in the following turn/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.62,
        }))
    }

    if (/the more times the user has performed stockpile, the more hp is recovered/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'heal_fraction_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.52,
        }))
    }

    if (/only usable when all pp are gone\. hurts the user/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'recoil_fraction_damage',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: { fraction: 0.25 },
            sourceText,
            parserConfidence: 0.62,
        }))
    }

    if (/stores energy for use with spit up and swallow/.test(text)) {
        ;['def', 'spdef'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: 1,
                params: { stat, delta: 1 },
                sourceText,
                parserConfidence: 0.58,
            }))
        })
    }

    if (/power depends on how many times the user performed stockpile|the lower the pp, the higher the power/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_random',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                minMultiplier: 1,
                maxMultiplier: 2,
            },
            sourceText,
            parserConfidence: 0.52,
        }))
    }

    if (/money is earned after the battle|revives a fainted party pok[eé]mon to half hp|allows user to flee wild battles/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'out_of_battle_or_party_flavor' },
            sourceText,
            parserConfidence: 0.75,
        }))
    }

    if (/swaps held items with the opponent|also steals opponent's held item|if the opponent is holding a berry, its effect is stolen by user|user's used hold item is restored/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'item_manipulation_flavor' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/user switches out immediately after attacking|user must switch out after attacking/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'self_switch_after_attack_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/strikes before a target's move|strikes before a target's priority move/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'priority_mod',
            trigger: 'on_select_move',
            target: 'self',
            chance: 1,
            params: { delta: 1 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/hits 1-10 times in a row/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'multi_hit',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { minHits: 1, maxHits: 10 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/guaranteed to hit twice in a row/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'never_miss',
            trigger: 'before_accuracy_check',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.9,
        }))
        maybePush(effects, makeEffect({
            op: 'multi_hit',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { minHits: 2, maxHits: 2 },
            sourceText,
            parserConfidence: 0.9,
        }))
    }

    if (/hits 3 times in a row|hits thrice in one turn|attacks thrice with more power each time/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'multi_hit',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { minHits: 3, maxHits: 3 },
            sourceText,
            parserConfidence: 0.85,
        }))
    }

    if (/power increases if user was hit first|power doubles if the user was attacked first|driven by frustration, the user attacks the target\. if the user's previous move has failed, the power of this move doubles/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_was_damaged_last_turn',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.76,
        }))
    }

    if (/power increases when user's stats have been raised/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_has_stat_boost',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.74,
        }))
    }

    if (/the more the user's stats are raised, the greater the move's power/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_has_stat_boost',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.74,
        }))
    }

    if (/power increases when opponent's stats have been raised/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_has_stat_boost',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.74,
        }))
    }

    if (/inflicts double damage if the target is poisoned/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_has_status_ailment',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/raises user's attack when hit/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage_if',
            trigger: 'after_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'user_was_damaged_last_turn',
                stat: 'atk',
                delta: 1,
            },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/the user gets teary eyed to make the target lose its combative spirit\. this lowers the target's attack and sp\. atk stats/.test(text)) {
        ;['atk', 'spatk'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'opponent',
                chance: chanceFromProb ?? 1,
                params: { stat, delta: -1 },
                sourceText,
                parserConfidence: 0.82,
            }))
        })
    }

    if (/opponent can only use moves that attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_status_move_block',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { turns: 3 },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/the user hides in the target's shadow, steals the target's stat boosts, and then attacks/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'steal_target_stat_boosts',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/protects the user and sharply lowers defence on contact|protects the user and lowers opponent's speed on contact|protects the user and inflicts damage on contact/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'damage_reduction_shield',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                scope: 'all',
                multiplier: 0,
                turns: 1,
            },
            sourceText,
            parserConfidence: 0.7,
        }))
    }

    if (/forces all pok[eé]mon on the field to eat their berries|opponent cannot use the same move in a row/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'turn_control_or_contact_flavor' },
            sourceText,
            parserConfidence: 0.66,
        }))
    }

    if (/prevents use of sound moves for two turns|makes the target act last this turn|slower pok[eé]mon move first in the turn for 5 turns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'turn_control_or_contact_flavor' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/move's power and type changes with the weather/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'weather_present',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/type and power change depending on the terrain in effect/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'terrain_present',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/changes target's ability to simple|changes the opponent's ability to insomnia|type matches memory item held|power and type depend on the user's held berry|type depends on the drive being held|changes type when the user has terastallized|type changes based on oricorio's form/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'type_or_ability_contextual_flavor' },
            sourceText,
            parserConfidence: 0.68,
        }))
    }

    if (/user becomes the target's type|changes the target's type to water/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'type_change_unmodeled_flavor' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/doesn't do anything/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'explicit_no_battle_effect' },
            sourceText,
            parserConfidence: 0.99,
        }))
    }

    if (/user loses 50% of its hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'hp_fraction_cost_max_hp',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { fraction: 0.5 },
            sourceText,
            parserConfidence: 0.88,
        }))
    }

    if (/cures paralysis, poison, and burns/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_status',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.86,
        }))
    }

    if (/the user bites the target with its psychic capabilities\. this can also destroy light screen and reflect/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_damage_guards',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: {},
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/deals damage and prevents target from healing/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'set_heal_block',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { turns: 5 },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/the user heals the target's status condition\. if the move succeeds, it also restores the user's own hp/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'purify_mixed_effect_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/if no terrain (is )?in effect/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'require_terrain',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { condition: 'terrain_present' },
            sourceText,
            parserConfidence: 0.82,
        }))
    }

    if (/raises all stats but user cannot switch out/.test(text)) {
        ;['atk', 'def', 'spatk', 'spdef', 'spd'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: chanceFromProb ?? 1,
                params: { stat, delta: 1 },
                sourceText,
                parserConfidence: 0.82,
            }))
        })
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'self_switch_lock_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/harshly lowers the opponent's defense and sharply raises their attack/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: { stat: 'def', delta: -2 },
            sourceText,
            parserConfidence: 0.84,
        }))
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: { stat: 'atk', delta: 2 },
            sourceText,
            parserConfidence: 0.84,
        }))
    }

    if (/lowers the opponent's speed and makes them weaker to fire-type moves/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 1,
            params: { stat: 'spd', delta: -1 },
            sourceText,
            parserConfidence: 0.82,
        }))
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'fire_weakness_modifier_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/the user eats its held berry, then sharply raises its defense stat/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target: 'self',
            chance: chanceFromProb ?? 1,
            params: { stat: 'def', delta: 2 },
            sourceText,
            parserConfidence: 0.84,
        }))
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: { reason: 'berry_consumption_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/boosts user[’']s attack and speed/.test(text)) {
        ;['atk', 'spd'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: chanceFromProb ?? 1,
                params: { stat, delta: 1 },
                sourceText,
                parserConfidence: 0.82,
            }))
        })
    }

    if (/power doubles if opponent is paralyzed, but cures it/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'power_modifier_if',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: {
                condition: 'target_is_paralyzed',
                multiplier: 2,
            },
            sourceText,
            parserConfidence: 0.8,
        }))
        maybePush(effects, makeEffect({
            op: 'clear_status_if',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { condition: 'target_is_paralyzed' },
            sourceText,
            parserConfidence: 0.75,
        }))
    }

    if (/opponent cannot escape\/switch|user cannot escape\/switch/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'flavor_only',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'escape_lock_single_battle_flavor' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/makes flying-type pok[eé]mon vulnerable to ground moves|hits the opponent, even during fly/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { reason: 'flying_ground_interaction_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    if (/heals the burns of its target/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'clear_status_if',
            trigger: 'on_hit',
            target: 'opponent',
            chance: 1,
            params: { condition: 'target_is_burned' },
            sourceText,
            parserConfidence: 0.8,
        }))
    }

    if (/may paralyze, burn or freeze opponent/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'apply_status_random',
            trigger: 'on_hit',
            target: 'opponent',
            chance: chanceFromProb ?? 0.2,
            params: { statuses: ['paralyze', 'burn', 'freeze'] },
            sourceText,
            parserConfidence: 0.84,
        }))
    }

    if (/lowers poisoned opponent's special attack and speed/.test(text)) {
        ;['spatk', 'spd'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage_if',
                trigger: 'on_hit',
                target: 'opponent',
                chance: 1,
                params: {
                    condition: 'target_is_poisoned',
                    stat,
                    delta: -1,
                },
                sourceText,
                parserConfidence: 0.84,
            }))
        })
    }

    if (/if the user's previous move has failed, the power of this move doubles/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'no_op',
            trigger: 'on_calculate_damage',
            target: 'self',
            chance: 1,
            params: { reason: 'previous_move_failed_condition_unsupported' },
            sourceText,
            parserConfidence: 0.72,
        }))
    }

    const statusPatterns = [
        { regex: /burns opponent|burns opponents|burns the opponent|may burn opponent|may burn opponents|may burn the opponent|may burn target|may burn the target/, status: 'burn' },
        { regex: /poisons opponent|poisons opponents|poisons the opponent|may poison opponent|may poison opponents|may poison the opponent|may poison target|may poison the target|badly poison/, status: 'poison' },
        { regex: /paralyzes opponent|paralyzes opponents|paralyzes the opponent|may paralyze opponent|may paralyze opponents|may paralyze the opponent|may paralyze target|may paralyze the target/, status: 'paralyze' },
        { regex: /may freeze opponent|may freeze opponents|freezes opponent|freezes opponents/, status: 'freeze' },
        { regex: /may confuse opponent|may confuse opponents|may confuse the opponent|may confuse target|may confuse the target|confuses opponent|confuses opponents|confuses the opponent|confuses all pok[eé]mon/, status: 'confuse' },
        { regex: /may cause flinching|may flinch|foe flinches/, status: 'flinch' },
        { regex: /puts opponent to sleep|sleep/, status: 'sleep' },
    ]

    statusPatterns.forEach(({ regex, status }) => {
        if (!regex.test(text)) return
        const isMaybe = /may/.test(text)
        maybePush(effects, withChance(makeEffect({
            op: 'apply_status',
            trigger: 'on_hit',
            target: 'opponent',
            chance: isMaybe ? undefined : 1,
            params: { status },
            sourceText,
            parserConfidence: 0.85,
        }), chanceFromProb ?? (isMaybe ? 0.3 : 1)))
    })

    const statRegex = /(may\s+)?((?:sharply|harshly)\s+)?(raise|raises|lower|lowers)\s+(?:the\s+)?(user['’]s|opponent['’]s|target['’]s)\s+([a-z\s\.]+?)(?:\.|,|$)/g
    let match = null
    while ((match = statRegex.exec(text)) !== null) {
        const [, maybeKeyword, sharplyKeyword, action, owner, statRaw] = match
        const stat = parseStatName(statRaw.replace(/\./g, '').trim())
        if (!stat) {
            warnings.push(`Không map được stat từ: ${match[0]}`)
            continue
        }

        const magnitude = sharplyKeyword ? 2 : 1
        const delta = action.startsWith('raise') ? magnitude : -magnitude
        const target = owner.includes('user') ? 'self' : 'opponent'
        const chance = maybeKeyword ? (chanceFromProb ?? 0.3) : 1

        maybePush(effects, makeEffect({
            op: 'stat_stage',
            trigger: 'on_hit',
            target,
            chance,
            params: { stat, delta },
            sourceText,
            parserConfidence: 0.88,
        }))
    }

    if (/may raise all user's stats at once|raises all user's stats at once|raise all user's stats/.test(text)) {
        ;['atk', 'def', 'spatk', 'spdef', 'spd'].forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance: chanceFromProb ?? 0.1,
                params: { stat, delta: 1 },
                sourceText,
                parserConfidence: 0.87,
            }))
        })
    }

    if (/sharply raises a random stat/.test(text)) {
        maybePush(effects, makeEffect({
            op: 'stat_stage_random',
            trigger: 'on_hit',
            target: 'self',
            chance: 1,
            params: {
                delta: 2,
                stats: ['atk', 'def', 'spatk', 'spdef', 'spd', 'acc', 'eva'],
            },
            sourceText,
            parserConfidence: 0.78,
        }))
    }

    const multiStatRegex = /(may\s+)?(sharply\s+)?(raise|raises|lower|lowers)\s+(user's|opponent's|target's)?\s*([a-z\s\.\/]+?)\s+and\s+([a-z\s\.\/]+?)(?:\.|,|$)/g
    while ((match = multiStatRegex.exec(text)) !== null) {
        const [, maybeKeyword, sharplyKeyword, action, ownerRaw, firstStatRaw, secondStatRaw] = match
        const statList = [
            ...parseStatList(firstStatRaw),
            ...parseStatList(secondStatRaw),
        ]
        if (statList.length === 0) continue

        const uniqueStats = [...new Set(statList)]
        const magnitude = sharplyKeyword ? 2 : 1
        const delta = action.startsWith('raise') ? magnitude : -magnitude
        const owner = String(ownerRaw || '').trim().toLowerCase()
        const target = owner.includes('opponent') || owner.includes('target') ? 'opponent' : 'self'
        const chance = maybeKeyword ? (chanceFromProb ?? 0.3) : 1

        uniqueStats.forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target,
                chance,
                params: { stat, delta },
                sourceText,
                parserConfidence: 0.82,
            }))
        })
    }

    const ownerOptionalStatRegex = /(may\s+)?(sharply\s+)?(raise|raises|lower|lowers)\s+([a-z\s\.]+?)(?:\.|,|$)/g
    while ((match = ownerOptionalStatRegex.exec(text)) !== null) {
        const [full, maybeKeyword, sharplyKeyword, action, statRaw] = match
        if (/user['’]s|opponent['’]s|target['’]s/.test(full)) continue
        if (/all user's stats/.test(full)) continue
        const stats = parseStatList(statRaw)
        if (stats.length === 0) continue

        const magnitude = sharplyKeyword ? 2 : 1
        const delta = action.startsWith('raise') ? magnitude : -magnitude
        const chance = maybeKeyword ? (chanceFromProb ?? 0.3) : 1

        stats.forEach((stat) => {
            maybePush(effects, makeEffect({
                op: 'stat_stage',
                trigger: 'on_hit',
                target: 'self',
                chance,
                params: { stat, delta },
                sourceText,
                parserConfidence: 0.75,
            }))
        })
    }

    const uniqueEffects = []
    const seen = new Set()
    effects.forEach((effect) => {
        const normalizedEffect = effect?.op === 'no_op'
            ? {
                ...effect,
                op: 'flavor_only',
                params: {
                    reason: String(effect?.params?.reason || 'unmodeled_effect').trim() || 'unmodeled_effect',
                },
            }
            : effect
        const key = JSON.stringify({
            op: normalizedEffect.op,
            trigger: normalizedEffect.trigger,
            target: normalizedEffect.target,
            chance: normalizedEffect.chance,
            params: normalizedEffect.params,
        })
        if (seen.has(key)) return
        seen.add(key)
        uniqueEffects.push(normalizedEffect)
    })

    return {
        effectSpecs: uniqueEffects,
        parserWarnings: warnings,
        parserConfidence: uniqueEffects.length === 0 ? 0 : Number((uniqueEffects
            .reduce((sum, effect) => sum + Number(effect.parserConfidence || 0), 0) / uniqueEffects.length)
            .toFixed(2)),
    }
}
