const clampChance = (value) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    if (parsed < 0) return 0
    if (parsed > 1) return 1
    return parsed
}

const shouldProc = (chance = 1, randomValue = Math.random()) => {
    const normalizedChance = clampChance(chance)
    if (normalizedChance >= 1) return true
    if (normalizedChance <= 0) return false
    return randomValue < normalizedChance
}

const clampPositiveInt = (value, fallback = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0, Math.floor(parsed))
}

const clampMultiplier = (value, fallback = 1) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0.1, Math.min(5, parsed))
}

const clampGuardMultiplier = (value, fallback = 0.5) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0, Math.min(1, parsed))
}

const clampFraction = (value, fallback = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(0, Math.min(1, parsed))
}

const STATUS_ALIASES = {
    burn: 'burn',
    burned: 'burn',
    poison: 'poison',
    poisoned: 'poison',
    toxic: 'poison',
    paralysis: 'paralyze',
    paralyzed: 'paralyze',
    paralyze: 'paralyze',
    freeze: 'freeze',
    frozen: 'freeze',
    sleep: 'sleep',
    asleep: 'sleep',
    confuse: 'confuse',
    confusion: 'confuse',
    flinch: 'flinch',
}

const normalizeStatus = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return ''
    return STATUS_ALIASES[normalized] || ''
}

const formatStatusLabel = (value = '') => {
    const normalized = normalizeStatus(value)
    if (normalized === 'burn') return 'bỏng'
    if (normalized === 'poison') return 'trúng độc'
    if (normalized === 'paralyze') return 'tê liệt'
    if (normalized === 'freeze') return 'đóng băng'
    if (normalized === 'sleep') return 'ngủ'
    if (normalized === 'confuse') return 'rối loạn'
    if (normalized === 'flinch') return 'choáng'
    return String(value || '').trim().toLowerCase()
}

const normalizeWeather = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (['sun', 'rain', 'sandstorm', 'hail'].includes(normalized)) return normalized
    return ''
}

const normalizeTerrain = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (['electric', 'grassy', 'misty', 'psychic'].includes(normalized)) return normalized
    return ''
}

const clampStage = (value, fallback = 0) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(-6, Math.min(6, Math.floor(parsed)))
}

const ensureArray = (value) => (Array.isArray(value) ? value : [])

const SUPPORTED_STAGE_STATS = new Set(['atk', 'def', 'spatk', 'spdef', 'spd', 'acc', 'eva'])

const normalizeStageMap = (value = {}) => {
    const source = value && typeof value === 'object' ? value : {}
    return Object.entries(source).reduce((acc, [rawStat, rawStage]) => {
        const stat = String(rawStat || '').trim().toLowerCase()
        if (!SUPPORTED_STAGE_STATS.has(stat)) return acc
        const stage = clampStage(rawStage, 0)
        if (stage === 0) return acc
        return {
            ...acc,
            [stat]: stage,
        }
    }, {})
}

const appendEffectLog = (result, message) => {
    if (!message) return
    result.logs.push(message)
}

const createBaseResult = () => ({
    applied: false,
    logs: [],
    statePatches: {
        self: {},
        opponent: {},
        field: {},
    },
})

const hasPositiveStage = (stages = {}) => {
    const source = stages && typeof stages === 'object' ? stages : {}
    return Object.values(source).some((value) => Number(value) > 0)
}

const hasNegativeStage = (stages = {}) => {
    const source = stages && typeof stages === 'object' ? stages : {}
    return Object.values(source).some((value) => Number(value) < 0)
}

const evaluateCondition = (context = {}, condition = '') => {
    const normalizedCondition = String(condition || '').trim().toLowerCase()
    if (!normalizedCondition) return false

    const targetStats = context?.targetStatStages && typeof context.targetStatStages === 'object'
        ? context.targetStatStages
        : {}
    const userStats = context?.userStatStages && typeof context.userStatStages === 'object'
        ? context.userStatStages
        : {}

    const checks = {
        target_was_damaged_last_turn: Boolean(context?.targetWasDamagedLastTurn),
        user_was_damaged_last_turn: Boolean(context?.userWasDamagedLastTurn),
        user_has_no_held_item: Boolean(context?.userHasNoHeldItem),
        target_is_dynamaxed: Boolean(context?.targetIsDynamaxed),
        user_acts_first: Boolean(context?.userActsFirst),
        is_super_effective: Boolean(context?.isSuperEffective),
        user_has_status_ailment: Boolean(String(context?.userStatus || '').trim()),
        target_has_status_ailment: Boolean(String(context?.targetStatus || '').trim()),
        user_is_poisoned: normalizeStatus(context?.userStatus) === 'poison',
        target_is_poisoned: normalizeStatus(context?.targetStatus) === 'poison',
        user_is_paralyzed: normalizeStatus(context?.userStatus) === 'paralyze',
        target_is_paralyzed: normalizeStatus(context?.targetStatus) === 'paralyze',
        user_is_burned: normalizeStatus(context?.userStatus) === 'burn',
        target_is_burned: normalizeStatus(context?.targetStatus) === 'burn',
        user_has_stat_boost: hasPositiveStage(userStats),
        target_has_stat_boost: hasPositiveStage(targetStats),
        user_has_stat_drop: hasNegativeStage(userStats),
        target_has_stat_drop: hasNegativeStage(targetStats),
        weather_present: Boolean(normalizeWeather(context?.weather)),
        weather_sunny: normalizeWeather(context?.weather) === 'sun',
        weather_rain: normalizeWeather(context?.weather) === 'rain',
        weather_sandstorm: normalizeWeather(context?.weather) === 'sandstorm',
        weather_hail: normalizeWeather(context?.weather) === 'hail',
        terrain_electric: normalizeTerrain(context?.terrain) === 'electric',
        terrain_grassy: normalizeTerrain(context?.terrain) === 'grassy',
        terrain_misty: normalizeTerrain(context?.terrain) === 'misty',
        terrain_psychic: normalizeTerrain(context?.terrain) === 'psychic',
        terrain_present: Boolean(normalizeTerrain(context?.terrain)),
        target_hp_below_half: (() => {
            const currentHp = Math.max(0, Number(context?.targetCurrentHp || 0))
            const maxHp = Math.max(1, Number(context?.targetMaxHp || 1))
            return currentHp > 0 && currentHp / maxHp < 0.5
        })(),
        target_hp_ratio_higher_than_user: (() => {
            const targetCurrentHp = Math.max(0, Number(context?.targetCurrentHp || 0))
            const targetMaxHp = Math.max(1, Number(context?.targetMaxHp || 1))
            const userCurrentHp = Math.max(0, Number(context?.userCurrentHp || 0))
            const userMaxHp = Math.max(1, Number(context?.userMaxHp || 1))
            return (targetCurrentHp / targetMaxHp) > (userCurrentHp / userMaxHp)
        })(),
    }

    return Boolean(checks[normalizedCondition])
}

const handlers = {
    no_op: () => createBaseResult(),
    flavor_only: () => createBaseResult(),

    apply_status: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const status = String(effect?.params?.status || '').trim().toLowerCase()
        const target = effect?.target === 'self' ? 'self' : 'opponent'
        if (!status) return result

        result.applied = true
        result.statePatches[target].status = status
        if (Number.isFinite(Number(effect?.params?.turns))) {
            result.statePatches[target].statusTurns = clampPositiveInt(effect?.params?.turns, 0)
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bị ${formatStatusLabel(status)}.`)
        return result
    },

    apply_status_random: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        const statuses = ensureArray(effect?.params?.statuses)
            .map((status) => normalizeStatus(status))
            .filter(Boolean)
        if (statuses.length === 0) return result

        const randomValue = typeof context?.random === 'function' ? context.random() : Math.random()
        const clampedIndex = Math.min(statuses.length - 1, Math.max(0, Math.floor(randomValue * statuses.length)))
        const chosenStatus = statuses[clampedIndex]
        if (!chosenStatus) return result

        result.applied = true
        result.statePatches[target].status = chosenStatus
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bị ${formatStatusLabel(chosenStatus)}.`)
        return result
    },

    clear_status: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        result.applied = true
        result.statePatches[target].clearStatus = true
        result.statePatches[target].status = ''
        result.statePatches[target].statusTurns = 0
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} được giải trạng thái bất lợi.`)
        return result
    },

    clear_status_if: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const condition = String(effect?.params?.condition || '').trim().toLowerCase()
        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        if (!condition) return result
        if (!evaluateCondition(context, condition)) return result

        result.applied = true
        result.statePatches[target].clearStatus = true
        result.statePatches[target].status = ''
        result.statePatches[target].statusTurns = 0
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} được giải trạng thái bởi điều kiện hiệu ứng.`)
        return result
    },

    apply_status_if: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const condition = String(effect?.params?.condition || '').trim().toLowerCase()
        const status = String(effect?.params?.status || '').trim().toLowerCase()
        const target = effect?.target === 'self' ? 'self' : 'opponent'
        if (!condition || !status) return result

        const targetStats = context?.targetStatStages && typeof context.targetStatStages === 'object'
            ? context.targetStatStages
            : {}
        const userStats = context?.userStatStages && typeof context.userStatStages === 'object'
            ? context.userStatStages
            : {}
        const hasPositiveStage = (stages = {}) => Object.values(stages).some((value) => Number(value) > 0)

        const checks = {
            target_has_stat_boost: hasPositiveStage(targetStats),
            user_has_stat_boost: hasPositiveStage(userStats),
        }

        if (!checks[condition]) return result

        result.applied = true
        result.statePatches[target].status = status
        if (Number.isFinite(Number(effect?.params?.turns))) {
            result.statePatches[target].statusTurns = clampPositiveInt(effect?.params?.turns, 0)
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bị ${formatStatusLabel(status)} bởi điều kiện hiệu ứng.`)
        return result
    },

    set_drowsy: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        const turns = Math.max(2, clampPositiveInt(effect?.params?.turns, 2))
        result.applied = true
        result.statePatches[target].volatileState = {
            drowsyTurns: turns,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bắt đầu buồn ngủ.`)
        return result
    },

    stat_stage: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        const stat = String(effect?.params?.stat || '').trim().toLowerCase()
        const delta = Number(effect?.params?.delta)
        if (!stat || !Number.isFinite(delta) || delta === 0) return result

        result.applied = true
        result.statePatches[target].statStages = {
            [stat]: delta,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} ${delta > 0 ? 'tăng' : 'giảm'} ${stat} ${Math.abs(delta)} bậc.`)
        return result
    },

    stat_stage_if: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const condition = String(effect?.params?.condition || '').trim().toLowerCase()
        const target = effect?.target === 'self' ? 'self' : 'opponent'
        const stat = String(effect?.params?.stat || '').trim().toLowerCase()
        const delta = Number(effect?.params?.delta)
        if (!condition || !stat || !Number.isFinite(delta) || delta === 0) return result

        if (!evaluateCondition(context, condition)) return result

        result.applied = true
        result.statePatches[target].statStages = {
            [stat]: delta,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} ${delta > 0 ? 'tăng' : 'giảm'} ${stat} ${Math.abs(delta)} bậc bởi điều kiện hiệu ứng.`)
        return result
    },

    stat_stage_set: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        const stat = String(effect?.params?.stat || '').trim().toLowerCase()
        const stage = clampStage(effect?.params?.stage, 0)
        if (!stat) return result

        result.applied = true
        result.statePatches[target].setStatStages = {
            [stat]: stage,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} đặt ${stat} về bậc ${stage}.`)
        return result
    },

    stat_stage_random: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        const delta = Number(effect?.params?.delta)
        const candidates = ensureArray(effect?.params?.stats)
            .map((entry) => String(entry || '').trim().toLowerCase())
            .filter(Boolean)
        if (!Number.isFinite(delta) || delta === 0 || candidates.length === 0) return result

        const randomValue = typeof context?.random === 'function' ? context.random() : Math.random()
        const clampedIndex = Math.min(candidates.length - 1, Math.max(0, Math.floor(randomValue * candidates.length)))
        const chosenStat = candidates[clampedIndex]

        result.applied = true
        result.statePatches[target].statStages = {
            [chosenStat]: delta,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} ${delta > 0 ? 'tăng' : 'giảm'} ngẫu nhiên ${chosenStat} ${Math.abs(delta)} bậc.`)
        return result
    },

    clear_stat_stages: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        result.applied = true
        result.statePatches[target].clearStatStages = true
        result.statePatches[target].statStages = {}
        result.statePatches[target].setStatStages = {}
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bị xóa toàn bộ biến đổi chỉ số.`)
        return result
    },

    copy_target_stat_stages: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        const sourceStages = target === 'self'
            ? normalizeStageMap(context?.targetStatStages)
            : normalizeStageMap(context?.userStatStages)

        result.applied = true
        result.statePatches[target].replaceStatStages = sourceStages
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} sao chép thay đổi chỉ số từ đối thủ.`)
        return result
    },

    swap_user_attack_defense_stages: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userStages = normalizeStageMap(context?.userStatStages)
        const nextAtk = clampStage(userStages?.def, 0)
        const nextDef = clampStage(userStages?.atk, 0)

        result.applied = true
        result.statePatches.self.setStatStages = {
            atk: nextAtk,
            def: nextDef,
        }
        appendEffectLog(result, 'Pokemon của bạn hoán đổi bậc Attack và Defense.')
        return result
    },

    average_attack_spatk_stages_with_target: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userStages = normalizeStageMap(context?.userStatStages)
        const targetStages = normalizeStageMap(context?.targetStatStages)
        const averageAtk = clampStage(Math.trunc(((userStages?.atk || 0) + (targetStages?.atk || 0)) / 2), 0)
        const averageSpAtk = clampStage(Math.trunc(((userStages?.spatk || 0) + (targetStages?.spatk || 0)) / 2), 0)

        result.applied = true
        result.statePatches.self.setStatStages = {
            atk: averageAtk,
            spatk: averageSpAtk,
        }
        result.statePatches.opponent.setStatStages = {
            atk: averageAtk,
            spatk: averageSpAtk,
        }
        appendEffectLog(result, 'Attack và Special Attack của hai bên được cân bằng.')
        return result
    },

    average_def_spdef_stages_with_target: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userStages = normalizeStageMap(context?.userStatStages)
        const targetStages = normalizeStageMap(context?.targetStatStages)
        const averageDef = clampStage(Math.trunc(((userStages?.def || 0) + (targetStages?.def || 0)) / 2), 0)
        const averageSpDef = clampStage(Math.trunc(((userStages?.spdef || 0) + (targetStages?.spdef || 0)) / 2), 0)

        result.applied = true
        result.statePatches.self.setStatStages = {
            def: averageDef,
            spdef: averageSpDef,
        }
        result.statePatches.opponent.setStatStages = {
            def: averageDef,
            spdef: averageSpDef,
        }
        appendEffectLog(result, 'Defense và Special Defense của hai bên được cân bằng.')
        return result
    },

    swap_attack_spatk_stages_with_target: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userStages = normalizeStageMap(context?.userStatStages)
        const targetStages = normalizeStageMap(context?.targetStatStages)

        result.applied = true
        result.statePatches.self.setStatStages = {
            atk: clampStage(targetStages?.atk, 0),
            spatk: clampStage(targetStages?.spatk, 0),
        }
        result.statePatches.opponent.setStatStages = {
            atk: clampStage(userStages?.atk, 0),
            spatk: clampStage(userStages?.spatk, 0),
        }
        appendEffectLog(result, 'Hai bên hoán đổi bậc Attack và Special Attack.')
        return result
    },

    swap_def_spdef_stages_with_target: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userStages = normalizeStageMap(context?.userStatStages)
        const targetStages = normalizeStageMap(context?.targetStatStages)

        result.applied = true
        result.statePatches.self.setStatStages = {
            def: clampStage(targetStages?.def, 0),
            spdef: clampStage(targetStages?.spdef, 0),
        }
        result.statePatches.opponent.setStatStages = {
            def: clampStage(userStages?.def, 0),
            spdef: clampStage(userStages?.spdef, 0),
        }
        appendEffectLog(result, 'Hai bên hoán đổi bậc Defense và Special Defense.')
        return result
    },

    swap_all_stat_stages_with_target: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userStages = normalizeStageMap(context?.userStatStages)
        const targetStages = normalizeStageMap(context?.targetStatStages)

        result.applied = true
        result.statePatches.self.replaceStatStages = targetStages
        result.statePatches.opponent.replaceStatStages = userStages
        appendEffectLog(result, 'Hai bên hoán đổi toàn bộ bậc chỉ số.')
        return result
    },

    swap_speed_stages_with_target: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userStages = normalizeStageMap(context?.userStatStages)
        const targetStages = normalizeStageMap(context?.targetStatStages)

        result.applied = true
        result.statePatches.self.setStatStages = {
            spd: clampStage(targetStages?.spd, 0),
        }
        result.statePatches.opponent.setStatStages = {
            spd: clampStage(userStages?.spd, 0),
        }
        appendEffectLog(result, 'Hai bên hoán đổi bậc Speed.')
        return result
    },

    invert_target_stat_stages: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        const sourceStages = target === 'self'
            ? normalizeStageMap(context?.userStatStages)
            : normalizeStageMap(context?.targetStatStages)
        const inverted = Object.entries(sourceStages).reduce((acc, [stat, value]) => ({
            ...acc,
            [stat]: clampStage(-Number(value), 0),
        }), {})

        result.applied = true
        result.statePatches[target].setStatStages = inverted
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bị đảo ngược biến đổi chỉ số.`)
        return result
    },

    heal_fraction_damage: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const fraction = Number(effect?.params?.fraction)
        const dealtDamage = Math.max(0, Number(context?.dealtDamage || 0))
        if (!Number.isFinite(fraction) || fraction <= 0 || dealtDamage <= 0) return result

        const healedHp = Math.max(0, Math.floor(dealtDamage * fraction))
        if (healedHp <= 0) return result

        result.applied = true
        result.statePatches.self.healHp = healedHp
        appendEffectLog(result, `Pokemon của bạn hồi ${healedHp} HP.`)
        return result
    },

    heal_fraction_max_hp: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const fraction = Number(effect?.params?.fraction)
        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        const maxHp = target === 'self'
            ? Math.max(1, Number(context?.userMaxHp || 0))
            : Math.max(1, Number(context?.targetMaxHp || 0))
        if (!Number.isFinite(fraction) || fraction <= 0 || maxHp <= 0) return result

        const healedHp = Math.max(0, Math.floor(maxHp * fraction))
        if (healedHp <= 0) return result

        result.applied = true
        result.statePatches[target].healHp = healedHp
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} hồi ${healedHp} HP.`)
        return result
    },

    heal_fraction_max_hp_if: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const condition = String(effect?.params?.condition || '').trim().toLowerCase()
        const fraction = Number(effect?.params?.fraction)
        if (!condition || !Number.isFinite(fraction) || fraction <= 0) return result
        if (!evaluateCondition(context, condition)) return result

        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        const maxHp = target === 'self'
            ? Math.max(1, Number(context?.userMaxHp || 0))
            : Math.max(1, Number(context?.targetMaxHp || 0))
        if (maxHp <= 0) return result

        const healedHp = Math.max(0, Math.floor(maxHp * fraction))
        if (healedHp <= 0) return result

        result.applied = true
        result.statePatches[target].healHp = healedHp
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} hồi ${healedHp} HP bởi điều kiện hiệu ứng.`)
        return result
    },

    recoil_fraction_damage: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const fraction = Number(effect?.params?.fraction)
        const dealtDamage = Math.max(0, Number(context?.dealtDamage || 0))
        if (!Number.isFinite(fraction) || fraction <= 0 || dealtDamage <= 0) return result

        const recoilHp = Math.max(0, Math.floor(dealtDamage * fraction))
        if (recoilHp <= 0) return result

        result.applied = true
        result.statePatches.self.recoilHp = recoilHp
        appendEffectLog(result, `Pokemon của bạn chịu ${recoilHp} sát thương phản lực.`)
        return result
    },

    hp_fraction_cost_max_hp: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const fraction = Number(effect?.params?.fraction)
        const userMaxHp = Math.max(1, Number(context?.userMaxHp || 0))
        if (!Number.isFinite(fraction) || fraction <= 0 || userMaxHp <= 0) return result

        const hpCost = Math.max(1, Math.floor(userMaxHp * fraction))
        result.applied = true
        result.statePatches.self.selfHpCost = hpCost
        appendEffectLog(result, `Pokemon của bạn tiêu hao ${hpCost} HP để thi triển chiêu.`)
        return result
    },

    self_faint: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.selfFaint = true
        appendEffectLog(result, 'Pokemon của bạn bị ngất sau khi dùng chiêu.')
        return result
    },

    fixed_damage_value: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const value = Math.max(0, clampPositiveInt(effect?.params?.value, 0))
        if (value <= 0) return result

        result.applied = true
        result.statePatches.self.fixedDamageValue = value
        return result
    },

    fixed_damage_from_user_level: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const level = Math.max(1, clampPositiveInt(context?.userLevel ?? context?.attackerLevel, 0))
        if (level <= 0) return result

        result.applied = true
        result.statePatches.self.fixedDamageValue = level
        return result
    },

    damage_fraction_target_current_hp: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const fraction = clampFraction(effect?.params?.fraction, 0)
        if (fraction <= 0) return result

        result.applied = true
        result.statePatches.self.fixedDamageFractionTargetCurrentHp = fraction
        return result
    },

    transfer_status_to_target: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userStatus = normalizeStatus(context?.userStatus)
        if (!userStatus) return result

        result.applied = true
        result.statePatches.opponent.status = userStatus
        const inheritedTurns = clampPositiveInt(context?.userStatusTurns, 0)
        if (inheritedTurns > 0) {
            result.statePatches.opponent.statusTurns = inheritedTurns
        }
        result.statePatches.self.clearStatus = true
        result.statePatches.self.status = ''
        result.statePatches.self.statusTurns = 0
        appendEffectLog(result, 'Pokemon của bạn truyền trạng thái sang mục tiêu.')
        return result
    },

    set_damage_to_user_current_hp: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.fixedDamageFromUserCurrentHp = true
        return result
    },

    enforce_target_survive: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        const minHp = Math.max(1, clampPositiveInt(effect?.params?.minHp, 1))
        result.applied = true
        result.statePatches.self.minTargetHp = minHp
        return result
    },

    force_target_ko: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.forceTargetKo = true
        return result
    },

    clear_damage_guards: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        result.applied = true
        result.statePatches[target].clearDamageGuards = true
        result.statePatches[target].damageGuards = {}
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bị phá lá chắn phòng thủ.`)
        return result
    },

    ignore_target_stat_stages: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.ignoreTargetStatStages = true
        return result
    },

    ignore_damage_guards: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.ignoreDamageGuards = true
        return result
    },

    use_target_defense_for_special: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.useTargetDefenseForSpecial = true
        return result
    },

    use_higher_offense_stat: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.useHigherOffenseStat = true
        return result
    },

    set_status_shield: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        const turns = Math.max(1, clampPositiveInt(effect?.params?.turns, 5))
        result.applied = true
        result.statePatches[target].volatileState = {
            statusShieldTurns: turns,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} được chắn trạng thái ${turns} lượt.`)
        return result
    },

    set_stat_drop_shield: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        const turns = Math.max(1, clampPositiveInt(effect?.params?.turns, 5))
        result.applied = true
        result.statePatches[target].volatileState = {
            statDropShieldTurns: turns,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} được chắn giảm chỉ số ${turns} lượt.`)
        return result
    },

    set_next_attack_always_crit: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.volatileState = {
            pendingAlwaysCrit: true,
        }
        appendEffectLog(result, 'Đòn kế tiếp của người dùng sẽ chí mạng.')
        return result
    },

    set_next_attack_never_miss: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.volatileState = {
            pendingNeverMiss: true,
        }
        appendEffectLog(result, 'Đòn kế tiếp của người dùng sẽ không trượt.')
        return result
    },

    set_heal_block: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        const turns = Math.max(1, clampPositiveInt(effect?.params?.turns, 5))
        result.applied = true
        result.statePatches[target].volatileState = {
            healBlockTurns: turns,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bị chặn hồi máu trong ${turns} lượt.`)
        return result
    },

    set_crit_block: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        const turns = Math.max(1, clampPositiveInt(effect?.params?.turns, 5))
        result.applied = true
        result.statePatches[target].volatileState = {
            critBlockTurns: turns,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} được chặn chí mạng trong ${turns} lượt.`)
        return result
    },

    crash_damage_on_miss_fraction_max_hp: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        if (Boolean(context?.didMoveHit)) return result

        const fraction = clampFraction(effect?.params?.fraction, 0)
        if (fraction <= 0) return result
        result.applied = true
        result.statePatches.self.crashDamageOnMissFractionMaxHp = fraction
        return result
    },

    clear_terrain: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.field.clearTerrain = true
        appendEffectLog(result, 'Địa hình sân đấu bị xóa.')
        return result
    },

    set_normal_moves_become_electric: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        const turns = Math.max(1, clampPositiveInt(effect?.params?.turns, 1))
        result.applied = true
        result.statePatches.field.normalMovesBecomeElectricTurns = turns
        appendEffectLog(result, `Các đòn hệ Thường được chuyển thành hệ Điện trong ${turns} lượt.`)
        return result
    },

    set_weather: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const weather = normalizeWeather(effect?.params?.weather)
        const turns = Math.max(1, clampPositiveInt(effect?.params?.turns, 5))
        if (!weather) return result

        result.applied = true
        result.statePatches.field.weather = weather
        result.statePatches.field.weatherTurns = turns
        appendEffectLog(result, `Thời tiết chuyển sang ${weather} trong ${turns} lượt.`)
        return result
    },

    set_terrain: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const terrain = normalizeTerrain(effect?.params?.terrain)
        const turns = Math.max(1, clampPositiveInt(effect?.params?.turns, 5))
        if (!terrain) return result

        result.applied = true
        result.statePatches.field.terrain = terrain
        result.statePatches.field.terrainTurns = turns
        appendEffectLog(result, `Sân đấu chuyển sang địa hình ${terrain} trong ${turns} lượt.`)
        return result
    },

    apply_bind: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'self' ? 'self' : 'opponent'
        const minTurns = Math.max(1, clampPositiveInt(effect?.params?.minTurns, 4))
        const maxTurns = Math.max(minTurns, clampPositiveInt(effect?.params?.maxTurns, 5))
        const bindFraction = clampFraction(effect?.params?.fraction, 1 / 16)

        const randomValue = typeof context?.random === 'function' ? context.random() : Math.random()
        const rolledTurns = minTurns + Math.floor(randomValue * (maxTurns - minTurns + 1))
        result.applied = true
        result.statePatches[target].volatileState = {
            bindTurns: rolledTurns,
            bindFraction,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bị trói trong ${rolledTurns} lượt.`)
        return result
    },

    require_recharge: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const turns = Math.max(1, clampPositiveInt(effect?.params?.turns, 1))
        result.applied = true
        result.statePatches.self.volatileState = {
            rechargeTurns: turns,
        }
        appendEffectLog(result, `Pokemon của bạn cần hồi sức ${turns} lượt.`)
        return result
    },

    set_status_move_block: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        const turns = Math.max(1, clampPositiveInt(effect?.params?.turns, 3))
        result.applied = true
        result.statePatches[target].volatileState = {
            statusMoveBlockTurns: turns,
        }
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} bị hạn chế dùng chiêu trạng thái trong ${turns} lượt.`)
        return result
    },

    steal_target_stat_boosts: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userStages = normalizeStageMap(context?.userStatStages)
        const targetStages = normalizeStageMap(context?.targetStatStages)
        const nextUserStages = { ...userStages }
        const nextTargetStages = { ...targetStages }

        for (const stat of SUPPORTED_STAGE_STATS) {
            const targetStage = clampStage(targetStages?.[stat], 0)
            if (targetStage <= 0) continue
            nextUserStages[stat] = clampStage((userStages?.[stat] || 0) + targetStage, 0)
            nextTargetStages[stat] = 0
        }

        result.applied = true
        result.statePatches.self.setStatStages = nextUserStages
        result.statePatches.opponent.setStatStages = nextTargetStages
        appendEffectLog(result, 'Pokemon của bạn cướp các bậc chỉ số dương của mục tiêu.')
        return result
    },

    prevent_repeat_move: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const moveName = String(effect?.params?.moveName || context?.moveName || '').trim()
        if (!moveName) return result
        result.applied = true
        result.statePatches.self.volatileState = {
            lockedRepeatMoveName: moveName,
        }
        appendEffectLog(result, `Chiêu ${moveName} không thể dùng liên tiếp.`)
        return result
    },

    damage_reduction_shield: (_context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, _context?.random?.())) return result

        const target = effect?.target === 'opponent' ? 'opponent' : 'self'
        const scope = String(effect?.params?.scope || 'all').trim().toLowerCase()
        const turns = clampPositiveInt(effect?.params?.turns, 5)
        const multiplier = clampGuardMultiplier(effect?.params?.multiplier, 0.5)
        if (turns <= 0) return result

        const guards = {}
        if (scope === 'all' || scope === 'physical') {
            guards.physical = { multiplier, turns }
        }
        if (scope === 'all' || scope === 'special') {
            guards.special = { multiplier, turns }
        }
        if (!guards.physical && !guards.special) return result

        result.applied = true
        result.statePatches[target].damageGuards = guards
        appendEffectLog(result, `${target === 'self' ? 'Pokemon của bạn' : 'Mục tiêu'} dựng lá chắn giảm sát thương.`)
        return result
    },

    power_modifier_if: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const condition = String(effect?.params?.condition || '').trim().toLowerCase()
        const multiplier = clampMultiplier(effect?.params?.multiplier, 1)
        if (!condition || multiplier <= 0) return result

        if (!evaluateCondition(context, condition)) return result

        result.applied = true
        result.statePatches.self.powerMultiplier = multiplier
        appendEffectLog(result, `Sức mạnh chiêu được nhân ${multiplier}x bởi điều kiện hiệu ứng.`)
        return result
    },

    power_modifier_random: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const hasRange = Number.isFinite(Number(effect?.params?.minMultiplier))
            || Number.isFinite(Number(effect?.params?.maxMultiplier))
        const minMultiplier = hasRange
            ? clampMultiplier(effect?.params?.minMultiplier, 1)
            : null
        const maxMultiplier = hasRange
            ? clampMultiplier(effect?.params?.maxMultiplier, minMultiplier ?? 1)
            : null
        const multiplier = hasRange
            ? clampMultiplier(
                (Math.min(minMultiplier, maxMultiplier)
                    + (Math.abs(maxMultiplier - minMultiplier) * Math.max(0, Math.min(1, Number(context?.random?.()) || 0)))),
                1
            )
            : clampMultiplier(effect?.params?.multiplier, 1)
        if (multiplier <= 0) return result

        result.applied = true
        result.statePatches.self.powerMultiplier = multiplier
        appendEffectLog(result, `Sức mạnh chiêu được nhân ${multiplier}x ngẫu nhiên.`)
        return result
    },

    power_modifier_by_user_hp: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const maxHp = Math.max(1, clampPositiveInt(context?.userMaxHp, 1))
        const currentHp = Math.max(0, Math.min(maxHp, clampPositiveInt(context?.userCurrentHp, maxHp)))
        const hpRatio = maxHp > 0 ? (currentHp / maxHp) : 1
        const mode = String(effect?.params?.mode || 'higher').trim().toLowerCase()

        let multiplier = hpRatio
        if (mode === 'lower') {
            multiplier = 0.5 + ((1 - hpRatio) * 1.5)
        }

        const normalizedMultiplier = clampMultiplier(multiplier, 1)
        result.applied = true
        result.statePatches.self.powerMultiplier = normalizedMultiplier
        appendEffectLog(result, `Sức mạnh chiêu được điều chỉnh theo tỷ lệ HP hiện tại (${normalizedMultiplier.toFixed(2)}x).`)
        return result
    },

    power_modifier_by_target_hp: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const maxHp = Math.max(1, clampPositiveInt(context?.targetMaxHp, 1))
        const currentHp = Math.max(0, Math.min(maxHp, clampPositiveInt(context?.targetCurrentHp, maxHp)))
        const hpRatio = maxHp > 0 ? (currentHp / maxHp) : 1
        const mode = String(effect?.params?.mode || 'higher').trim().toLowerCase()

        let multiplier = hpRatio
        if (mode === 'lower') {
            multiplier = 0.5 + ((1 - hpRatio) * 1.5)
        }

        const normalizedMultiplier = clampMultiplier(multiplier, 1)
        result.applied = true
        result.statePatches.self.powerMultiplier = normalizedMultiplier
        appendEffectLog(result, `Sức mạnh chiêu được điều chỉnh theo HP hiện tại của mục tiêu (${normalizedMultiplier.toFixed(2)}x).`)
        return result
    },

    power_modifier_by_speed_relation: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const userSpeed = Math.max(1, clampPositiveInt(context?.userSpeed, 1))
        const targetSpeed = Math.max(1, clampPositiveInt(context?.targetSpeed, 1))
        const mode = String(effect?.params?.mode || 'faster').trim().toLowerCase()

        const ratio = mode === 'slower'
            ? (targetSpeed / userSpeed)
            : (userSpeed / targetSpeed)
        const multiplier = clampMultiplier(Math.max(0.5, Math.min(2.5, ratio)), 1)

        result.applied = true
        result.statePatches.self.powerMultiplier = multiplier
        appendEffectLog(result, `Sức mạnh chiêu được điều chỉnh theo tương quan tốc độ (${multiplier.toFixed(2)}x).`)
        return result
    },

    use_defense_as_attack: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.useDefenseAsAttack = true
        return result
    },

    use_target_attack_as_attack: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result
        result.applied = true
        result.statePatches.self.useTargetAttackAsAttack = true
        return result
    },

    priority_mod: (_context, effect) => {
        const result = createBaseResult()
        const delta = Number(effect?.params?.delta)
        if (!Number.isFinite(delta) || delta === 0) return result

        result.applied = true
        result.statePatches.self.priorityDelta = delta
        appendEffectLog(result, `Độ ưu tiên đòn đánh thay đổi ${delta > 0 ? '+' : ''}${delta}.`)
        return result
    },

    priority_mod_if: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const condition = String(effect?.params?.condition || '').trim().toLowerCase()
        const delta = Number(effect?.params?.delta)
        if (!condition || !Number.isFinite(delta) || delta === 0) return result
        if (!evaluateCondition(context, condition)) return result

        result.applied = true
        result.statePatches.self.priorityDelta = delta
        appendEffectLog(result, `Độ ưu tiên đòn đánh thay đổi ${delta > 0 ? '+' : ''}${delta} theo điều kiện.`)
        return result
    },

    require_terrain: (context, effect) => {
        const result = createBaseResult()
        if (!shouldProc(effect?.chance, context?.random?.())) return result

        const condition = String(effect?.params?.condition || 'terrain_present').trim().toLowerCase()
        result.applied = true
        result.statePatches.self.requireTerrain = condition === 'terrain_present'
        return result
    },

    crit_rate: (_context, effect) => {
        const result = createBaseResult()
        const multiplier = Number(effect?.params?.multiplier)
        if (!Number.isFinite(multiplier) || multiplier <= 0) return result

        result.applied = true
        result.statePatches.self.critRateMultiplier = multiplier
        return result
    },

    always_crit: () => {
        const result = createBaseResult()
        result.applied = true
        result.statePatches.self.alwaysCrit = true
        return result
    },

    never_miss: () => {
        const result = createBaseResult()
        result.applied = true
        result.statePatches.self.neverMiss = true
        return result
    },

    multi_hit: (_context, effect) => {
        const result = createBaseResult()
        const minHits = Math.max(1, Math.floor(Number(effect?.params?.minHits || 1)))
        const maxHits = Math.max(minHits, Math.floor(Number(effect?.params?.maxHits || minHits)))
        result.applied = true
        result.statePatches.self.multiHit = { minHits, maxHits }
        return result
    },
}

export const getEffectHandler = (op) => handlers[String(op || '').trim()]
export const getRegisteredEffectOps = () => Object.keys(handlers)

export const applyEffectSpecs = ({ effectSpecs = [], context = {} } = {}) => {
    const aggregate = {
        appliedEffects: [],
        logs: [],
        statePatches: {
            self: {},
            opponent: {},
            field: {},
        },
    }

    ensureArray(effectSpecs).forEach((effectSpec) => {
        const op = String(effectSpec?.op || '').trim()
        if (!op) return
        const handler = getEffectHandler(op)
        if (!handler) {
            aggregate.logs.push(`Unsupported effect op: ${op}`)
            return
        }

        const result = handler(context, effectSpec)
        if (!result?.applied) return

        aggregate.appliedEffects.push(effectSpec)
        aggregate.logs.push(...ensureArray(result.logs))

        aggregate.statePatches.self = {
            ...aggregate.statePatches.self,
            ...result.statePatches?.self,
            statStages: {
                ...(aggregate.statePatches.self?.statStages || {}),
                ...(result.statePatches?.self?.statStages || {}),
            },
            setStatStages: {
                ...(aggregate.statePatches.self?.setStatStages || {}),
                ...(result.statePatches?.self?.setStatStages || {}),
            },
            damageGuards: {
                ...(aggregate.statePatches.self?.damageGuards || {}),
                ...(result.statePatches?.self?.damageGuards || {}),
            },
            volatileState: {
                ...(aggregate.statePatches.self?.volatileState || {}),
                ...(result.statePatches?.self?.volatileState || {}),
            },
        }
        aggregate.statePatches.opponent = {
            ...aggregate.statePatches.opponent,
            ...result.statePatches?.opponent,
            statStages: {
                ...(aggregate.statePatches.opponent?.statStages || {}),
                ...(result.statePatches?.opponent?.statStages || {}),
            },
            setStatStages: {
                ...(aggregate.statePatches.opponent?.setStatStages || {}),
                ...(result.statePatches?.opponent?.setStatStages || {}),
            },
            damageGuards: {
                ...(aggregate.statePatches.opponent?.damageGuards || {}),
                ...(result.statePatches?.opponent?.damageGuards || {}),
            },
            volatileState: {
                ...(aggregate.statePatches.opponent?.volatileState || {}),
                ...(result.statePatches?.opponent?.volatileState || {}),
            },
        }
        aggregate.statePatches.field = {
            ...aggregate.statePatches.field,
            ...(result.statePatches?.field || {}),
        }
    })

    return aggregate
}
