export const normalizeIpAddress = (value = '') => {
    let ip = String(value || '').trim().toLowerCase()
    if (!ip) return ''

    if (ip.includes(',')) {
        ip = ip.split(',')[0].trim()
    }

    if (ip.startsWith('[') && ip.includes(']')) {
        ip = ip.slice(1, ip.indexOf(']')).trim()
    }

    if (ip.startsWith('::ffff:')) {
        ip = ip.slice(7)
    }

    const isIpv4WithPort = /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)
    if (isIpv4WithPort) {
        ip = ip.split(':')[0]
    }

    if (ip === '::1') {
        return '127.0.0.1'
    }

    if (ip === 'unknown' || ip === '::' || ip === '0.0.0.0') {
        return ''
    }

    return ip
}

const getForwardedClientIp = (headers = {}) => {
    const fromCloudflare = String(headers['cf-connecting-ip'] || '').trim()
    const fromRealIp = String(headers['x-real-ip'] || '').trim()
    const fromForwarded = String(headers['x-forwarded-for'] || '').trim()
    return normalizeIpAddress(fromCloudflare || fromRealIp || fromForwarded || '')
}

const isPrivateOrLoopbackIp = (ip = '') => {
    const normalizedIp = normalizeIpAddress(ip)
    if (!normalizedIp) return false

    if (normalizedIp === '127.0.0.1') return true
    if (normalizedIp.startsWith('10.')) return true
    if (normalizedIp.startsWith('192.168.')) return true
    if (normalizedIp.startsWith('169.254.')) return true
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedIp)) return true
    if (normalizedIp.startsWith('fc') || normalizedIp.startsWith('fd')) return true
    if (normalizedIp.startsWith('fe80:')) return true

    return false
}

export const extractClientIp = (req) => {
    const trustProxy = Boolean(req?.app?.get && req.app.get('trust proxy'))
    const directIp = normalizeIpAddress(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '')
    const forwardedIp = getForwardedClientIp(req?.headers || {})

    if (trustProxy) {
        return forwardedIp || directIp
    }

    if (!directIp) {
        return forwardedIp
    }

    if (forwardedIp && isPrivateOrLoopbackIp(directIp)) {
        return forwardedIp
    }

    return directIp
}
