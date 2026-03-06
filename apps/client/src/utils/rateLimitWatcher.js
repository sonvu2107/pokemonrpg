export const GLOBAL_RATE_LIMIT_EVENT = 'app:global-rate-limit'

const DUPLICATE_EVENT_WINDOW_MS = 2500

let isWatcherInstalled = false
let lastEventSignature = ''
let lastEventAt = 0

const getRequestUrl = (input, fallbackUrl = '') => {
    if (typeof input === 'string') return input
    if (input && typeof input.url === 'string') return input.url
    return fallbackUrl
}

const parseRetryAfterSeconds = (response, payload = {}) => {
    const headerValue = Number(response?.headers?.get?.('Retry-After') || 0)
    const bodyValue = Number(payload?.retryAfterSeconds || 0)
    const resolved = Math.max(headerValue, bodyValue)
    if (!Number.isFinite(resolved) || resolved <= 0) {
        return 0
    }
    return Math.ceil(resolved)
}

const shouldDispatchRateLimitEvent = (signature) => {
    const now = Date.now()
    if (signature === lastEventSignature && (now - lastEventAt) < DUPLICATE_EVENT_WINDOW_MS) {
        return false
    }
    lastEventSignature = signature
    lastEventAt = now
    return true
}

export const installGlobalRateLimitWatcher = () => {
    if (typeof window === 'undefined' || isWatcherInstalled) {
        return
    }

    isWatcherInstalled = true
    const originalFetch = window.fetch.bind(window)

    window.fetch = async (...args) => {
        const response = await originalFetch(...args)

        if (response?.status === 429) {
            const requestInput = args[0]
            const requestUrl = getRequestUrl(requestInput, String(response?.url || ''))
            const isApiRequest = requestUrl.includes('/api/')

            if (isApiRequest) {
                let payload = null
                try {
                    payload = await response.clone().json()
                } catch {
                    payload = null
                }

                const code = String(payload?.code || '').trim()
                if (code === 'GLOBAL_RATE_LIMIT') {
                    const retryAfterSeconds = parseRetryAfterSeconds(response, payload)
                    const message = String(payload?.message || 'Giáo sư Oak: Bạn thao tác hơi nhanh. Hãy nghỉ một chút rồi tiếp tục hành trình.').trim()
                    const signature = `${code}:${retryAfterSeconds}:${message}`

                    if (shouldDispatchRateLimitEvent(signature)) {
                        window.dispatchEvent(new CustomEvent(GLOBAL_RATE_LIMIT_EVENT, {
                            detail: {
                                code,
                                message,
                                retryAfterSeconds,
                            },
                        }))
                    }
                }
            }
        }

        return response
    }
}
