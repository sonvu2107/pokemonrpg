const GAMEPLAY_TAB_STATE_TTL_MS = 15 * 1000
const GAMEPLAY_TAB_CLEANUP_INTERVAL = 200

const gameplayTabState = new Map()
let gameplayTabRequestCount = 0

const normalize = (value) => String(value || '').trim()

const cleanupGameplayTabState = (nowMs = Date.now()) => {
    for (const [stateKey, state] of gameplayTabState.entries()) {
        const updatedAt = Number(state?.updatedAt || 0)
        if ((nowMs - updatedAt) > GAMEPLAY_TAB_STATE_TTL_MS) {
            gameplayTabState.delete(stateKey)
        }
    }
}

export const requireActiveGameplayTab = (options = {}) => {
    const actionLabel = normalize(options.actionLabel) || 'thao tac game'

    return (req, res, next) => {
        if (req.user?.tokenType === 'internal') {
            return next()
        }

        const userId = normalize(req.user?.userId)
        const sessionId = normalize(req.user?.sessionId)
        const tabId = normalize(req.get('x-vnpet-gameplay-tab') || req.get('x-vnpet-tab-id'))
        const wantsClaim = normalize(req.get('x-vnpet-gameplay-claim')) === '1'

        if (!userId || !sessionId || !tabId) {
            return res.status(409).json({
                ok: false,
                code: 'GAMEPLAY_TAB_REQUIRED',
                message: 'Tab nay chua san sang de choi. Hay tai lai trang va thu lai.',
            })
        }

        gameplayTabRequestCount += 1
        const nowMs = Date.now()
        if (gameplayTabRequestCount % GAMEPLAY_TAB_CLEANUP_INTERVAL === 0) {
            cleanupGameplayTabState(nowMs)
        }

        const stateKey = `${userId}:${sessionId}`
        const currentState = gameplayTabState.get(stateKey)
        const isStale = !currentState || (nowMs - Number(currentState.updatedAt || 0)) > GAMEPLAY_TAB_STATE_TTL_MS
        const isSameTab = normalize(currentState?.tabId) === tabId

        if (isStale || isSameTab || wantsClaim) {
            gameplayTabState.set(stateKey, {
                tabId,
                updatedAt: nowMs,
                actionLabel,
            })
            req.gameplayTab = { tabId, actionLabel }
            return next()
        }

        return res.status(409).json({
            ok: false,
            code: 'GAMEPLAY_TAB_LOCKED',
            message: `Tab nay dang o che do xem. Hay quay lai tab dang choi de tiep tuc ${actionLabel}.`,
        })
    }
}
