export const createMockReq = ({
    userId = '',
    body = {},
    params = {},
    query = {},
    headers = {},
} = {}) => ({
    user: { userId },
    body,
    params,
    query,
    headers,
})

export const createMockRes = () => ({
    statusCode: 200,
    payload: null,
    status(code) {
        this.statusCode = code
        return this
    },
    json(payload) {
        this.payload = payload
        return this
    },
})

export const createMockNext = () => {
    const state = {
        error: null,
    }
    const next = (error = null) => {
        state.error = error || null
    }
    next.state = state
    return next
}

export const getRouteHandler = (router, routePath, { handlerIndex = 'last' } = {}) => {
    const layer = router?.stack?.find((entry) => entry?.route?.path === routePath)
    const handlers = Array.isArray(layer?.route?.stack) ? layer.route.stack : []
    if (!layer || handlers.length === 0) {
        throw new Error(`Cannot resolve route handler for path: ${routePath}`)
    }

    const index = handlerIndex === 'last'
        ? handlers.length - 1
        : Math.max(0, Number(handlerIndex) || 0)
    const handler = handlers[index]?.handle
    if (typeof handler !== 'function') {
        throw new Error(`Cannot resolve route handler function for path: ${routePath}`)
    }
    return handler
}

export const runRouteHandler = async (handler, { req, res, next } = {}) => {
    const resolvedReq = req || createMockReq()
    const resolvedRes = res || createMockRes()
    const resolvedNext = next || createMockNext()
    await handler(resolvedReq, resolvedRes, resolvedNext)
    if (resolvedNext?.state?.error) {
        throw resolvedNext.state.error
    }
    return { req: resolvedReq, res: resolvedRes, next: resolvedNext }
}

export const createMethodPatchHarness = () => {
    const patches = []
    return {
        patch(target, key, replacement) {
            patches.push({ target, key, original: target[key] })
            target[key] = replacement
        },
        restore() {
            for (let index = patches.length - 1; index >= 0; index -= 1) {
                const entry = patches[index]
                entry.target[entry.key] = entry.original
            }
            patches.length = 0
        },
    }
}

export const withMockedRandom = async (value, run) => {
    const originalRandom = Math.random
    try {
        Math.random = () => value
        return await run()
    } finally {
        Math.random = originalRandom
    }
}
