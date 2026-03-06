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

    return ip
}

export const extractClientIp = (req) => {
    const trustProxy = Boolean(req?.app?.get && req.app.get('trust proxy'))
    if (trustProxy) {
        const fromCloudflare = String(req.headers['cf-connecting-ip'] || '').trim()
        const fromRealIp = String(req.headers['x-real-ip'] || '').trim()
        const fromForwarded = String(req.headers['x-forwarded-for'] || '').trim()
        const fallback = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || ''
        return normalizeIpAddress(fromCloudflare || fromRealIp || fromForwarded || fallback)
    }

    const directIp = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || ''
    return normalizeIpAddress(directIp)
}
