const TURN_PHASE_ORDER = [
    'turn_start',
    'pre_action_1',
    'action_1',
    'post_action_1',
    'pre_action_2',
    'action_2',
    'post_action_2',
    'turn_end',
    'faint_resolution',
    'forced_switch',
]

const TURN_PHASE_LABELS = {
    turn_start: 'Khởi đầu lượt',
    pre_action_1: 'Chuẩn bị hành động 1',
    action_1: 'Hành động 1',
    post_action_1: 'Sau hành động 1',
    pre_action_2: 'Chuẩn bị hành động 2',
    action_2: 'Hành động 2',
    post_action_2: 'Sau hành động 2',
    turn_end: 'Cuối lượt',
    faint_resolution: 'Xử lý bại trận',
    forced_switch: 'Đổi Pokemon bắt buộc',
}

export const createTurnTimeline = ({ playerActsFirst = true } = {}) => ({
    playerActsFirst: Boolean(playerActsFirst),
    phases: [],
})

const resolveTurnActorPhaseIndex = (timeline, actor = 'player') => {
    const normalizedActor = String(actor || '').trim().toLowerCase() === 'opponent' ? 'opponent' : 'player'
    if (normalizedActor === 'player') {
        return timeline?.playerActsFirst ? 1 : 2
    }
    return timeline?.playerActsFirst ? 2 : 1
}

export const resolveTurnActorPhaseKeys = (timeline, actor = 'player') => {
    const index = resolveTurnActorPhaseIndex(timeline, actor)
    return {
        preAction: `pre_action_${index}`,
        action: `action_${index}`,
        postAction: `post_action_${index}`,
    }
}

const ensureTurnPhase = (timeline, key, actor = 'system') => {
    const normalizedKey = String(key || '').trim().toLowerCase()
    if (!normalizedKey) return null

    const existing = Array.isArray(timeline?.phases)
        ? timeline.phases.find((entry) => entry.key === normalizedKey)
        : null
    if (existing) return existing

    const phase = {
        key: normalizedKey,
        actor: String(actor || 'system').trim().toLowerCase() || 'system',
        label: TURN_PHASE_LABELS[normalizedKey] || normalizedKey,
        order: TURN_PHASE_ORDER.indexOf(normalizedKey),
        events: [],
        lines: [],
    }
    timeline.phases.push(phase)
    timeline.phases.sort((a, b) => a.order - b.order)
    return phase
}

export const appendTurnPhaseEvent = (timeline, {
    phaseKey,
    actor = 'system',
    kind = 'message',
    line = '',
    ...payload
} = {}) => {
    const phase = ensureTurnPhase(timeline, phaseKey, actor)
    if (!phase) return
    const normalizedLine = String(line || '').trim()
    phase.events.push({
        kind: String(kind || 'message').trim().toLowerCase() || 'message',
        actor: String(actor || phase.actor || 'system').trim().toLowerCase() || 'system',
        ...payload,
        ...(normalizedLine ? { line: normalizedLine } : {}),
    })
    if (normalizedLine) {
        phase.lines.push(normalizedLine)
    }
}

export const appendTurnPhaseLines = (timeline, {
    phaseKey,
    actor = 'system',
    kind = 'message',
    lines = [],
    ...payload
} = {}) => {
    ;(Array.isArray(lines) ? lines : []).forEach((line) => {
        appendTurnPhaseEvent(timeline, {
            phaseKey,
            actor,
            kind,
            line,
            ...payload,
        })
    })
}

export const finalizeTurnTimeline = (timeline) => (Array.isArray(timeline?.phases) ? timeline.phases : [])
    .filter((phase) => Array.isArray(phase?.lines) && phase.lines.length > 0)
    .map((phase) => ({
        key: phase.key,
        actor: phase.actor,
        label: phase.label,
        events: Array.isArray(phase.events) ? phase.events : [],
        lines: Array.isArray(phase.lines) ? phase.lines : [],
    }))

export const flattenTurnPhaseLines = (turnPhases = []) => (Array.isArray(turnPhases) ? turnPhases : [])
    .flatMap((phase) => (Array.isArray(phase?.lines) ? phase.lines : []))
