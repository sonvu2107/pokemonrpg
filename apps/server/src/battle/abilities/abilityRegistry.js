const normalizeAbilityId = (value = '') => String(value || '').trim().toLowerCase()
const normalizeTypeToken = (value = '') => String(value || '').trim().toLowerCase()
const normalizeStatusToken = (value = '') => String(value || '').trim().toLowerCase()
const normalizeWeatherToken = (value = '') => String(value || '').trim().toLowerCase()

const createResult = ({ applied = false, logs = [], statePatches = null } = {}) => ({
    applied: Boolean(applied),
    logs: Array.isArray(logs) ? logs.filter(Boolean).map((entry) => String(entry)) : [],
    statePatches: {
        self: statePatches?.self && typeof statePatches.self === 'object' ? statePatches.self : {},
        opponent: statePatches?.opponent && typeof statePatches.opponent === 'object' ? statePatches.opponent : {},
        field: statePatches?.field && typeof statePatches.field === 'object' ? statePatches.field : {},
    },
})

const createNoopResult = () => createResult()

const createDamageImmunityHook = ({
    moveType,
    message,
    healFractionMaxHp = 0,
}) => (context = {}) => {
    const didMoveHit = context?.didMoveHit !== false
    const isDamagingMove = context?.isDamagingMove !== false
    const incomingMoveType = normalizeTypeToken(context?.incomingMoveType)
    if (!didMoveHit || !isDamagingMove || incomingMoveType !== moveType) {
        return createNoopResult()
    }

    return createResult({
        applied: true,
        logs: [message],
        statePatches: {
            self: {
                preventDamage: true,
                healFractionMaxHp,
            },
        },
    })
}

const createStatusImmunityHook = ({
    blockedStatuses = [],
    message,
}) => (context = {}) => {
    const incomingStatus = normalizeStatusToken(context?.incomingStatus)
    if (!incomingStatus || !blockedStatuses.includes(incomingStatus)) {
        return createNoopResult()
    }

    return createResult({
        applied: true,
        logs: [message],
        statePatches: {
            self: {
                preventStatus: true,
            },
        },
    })
}

const freezeHookMap = (hooks = {}) => Object.freeze({
    ...(hooks && typeof hooks === 'object' ? hooks : {}),
})

export const ABILITY_REGISTRY = Object.freeze({
    levitate: freezeHookMap({
        onTryHit: createDamageImmunityHook({
            moveType: 'ground',
            message: 'Levitate giúp Pokemon miễn nhiễm với đòn hệ Đất.',
        }),
    }),
    intimidate: freezeHookMap({
        onSwitchIn: () => createResult({
            applied: true,
            logs: ['Intimidate kích hoạt: đối thủ bị giảm Tấn công.'],
            statePatches: {
                opponent: {
                    statStages: { atk: -1 },
                },
            },
        }),
    }),
    immunity: freezeHookMap({
        onStatusAttempt: createStatusImmunityHook({
            blockedStatuses: ['poison'],
            message: 'Immunity ngăn Pokemon bị trúng độc.',
        }),
    }),
    insomnia: freezeHookMap({
        onStatusAttempt: createStatusImmunityHook({
            blockedStatuses: ['sleep'],
            message: 'Insomnia ngăn Pokemon bị gây ngủ.',
        }),
    }),
    magma_armor: freezeHookMap({
        onStatusAttempt: createStatusImmunityHook({
            blockedStatuses: ['freeze'],
            message: 'Magma Armor ngăn Pokemon bị đóng băng.',
        }),
    }),
    water_absorb: freezeHookMap({
        onTryHit: createDamageImmunityHook({
            moveType: 'water',
            message: 'Water Absorb hấp thụ đòn hệ Nước và hồi HP.',
            healFractionMaxHp: 0.25,
        }),
    }),
    volt_absorb: freezeHookMap({
        onTryHit: createDamageImmunityHook({
            moveType: 'electric',
            message: 'Volt Absorb hấp thụ đòn hệ Điện và hồi HP.',
            healFractionMaxHp: 0.25,
        }),
    }),
    flash_fire: freezeHookMap({
        onTryHit: createDamageImmunityHook({
            moveType: 'fire',
            message: 'Flash Fire vô hiệu hóa đòn hệ Lửa.',
        }),
    }),
    mold_breaker: freezeHookMap({}),
    teravolt: freezeHookMap({}),
    turboblaze: freezeHookMap({}),
    swift_swim: freezeHookMap({
        beforeSpeedCalc: (context = {}) => {
            if (normalizeWeatherToken(context?.weather) !== 'rain') return createNoopResult()
            return createResult({
                applied: true,
                statePatches: {
                    self: {
                        speedMultiplier: 2,
                    },
                },
            })
        },
    }),
    chlorophyll: freezeHookMap({
        beforeSpeedCalc: (context = {}) => {
            if (normalizeWeatherToken(context?.weather) !== 'sun') return createNoopResult()
            return createResult({
                applied: true,
                statePatches: {
                    self: {
                        speedMultiplier: 2,
                    },
                },
            })
        },
    }),
})

export const getRegisteredAbilityIds = () => Object.keys(ABILITY_REGISTRY)

export const getAbilityDefinition = (abilityId = '') => {
    const normalized = normalizeAbilityId(abilityId)
    if (!normalized) return null
    const definition = ABILITY_REGISTRY[normalized]
    return definition && typeof definition === 'object'
        ? freezeHookMap(definition)
        : null
}

export const getAbilityHookHandler = ({ abilityId = '', hookName = '' } = {}) => {
    const definition = getAbilityDefinition(abilityId)
    if (!definition) return null
    const normalizedHookName = String(hookName || '').trim()
    if (!normalizedHookName) return null
    const handler = definition[normalizedHookName]
    return typeof handler === 'function' ? handler : null
}
