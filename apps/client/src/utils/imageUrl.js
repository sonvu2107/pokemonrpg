const CLOUDINARY_UPLOAD_MARKER = '/image/upload/'

const hasAbsoluteProtocol = (value = '') => /^(https?:)?\/\//i.test(value)

const toHttpsUrl = (value = '') => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    return raw
}

const buildCloudinaryTransform = ({ width = 0, quality = 'auto', extraTransform = '' } = {}) => {
    const parts = []
    const normalizedExtra = String(extraTransform || '').trim().replace(/^,+|,+$/g, '')
    const normalizedQuality = String(quality || 'auto').trim() || 'auto'
    const normalizedWidth = Number(width)

    if (normalizedExtra) {
        parts.push(normalizedExtra)
    }

    if (!/\bf_auto\b/.test(normalizedExtra)) {
        parts.push('f_auto')
    }

    if (!/\bq_[^,]+\b/.test(normalizedExtra)) {
        parts.push(`q_${normalizedQuality}`)
    }

    if (Number.isFinite(normalizedWidth) && normalizedWidth > 0 && !/\bw_\d+\b/.test(normalizedExtra)) {
        parts.push(`w_${Math.round(normalizedWidth)}`)
    }

    return parts.filter(Boolean).join(',')
}

export const withCloudinaryTransform = (value = '', options = {}) => {
    const raw = toHttpsUrl(value)
    if (!raw) return ''

    if (!raw.includes('res.cloudinary.com') || !raw.includes(CLOUDINARY_UPLOAD_MARKER)) {
        return raw
    }

    const transform = buildCloudinaryTransform(options)
    if (!transform) return raw

    const transformedMarker = `${CLOUDINARY_UPLOAD_MARKER}${transform}/`
    if (raw.includes(transformedMarker)) {
        return raw
    }

    const [prefix, suffix] = raw.split(CLOUDINARY_UPLOAD_MARKER)
    if (!prefix || !suffix) {
        return raw
    }

    return `${prefix}${transformedMarker}${suffix.replace(/^\/+/, '')}`
}

export const getImageUrl = (value = '', options = {}) => {
    const raw = String(value || '').trim()
    const fallback = String(options?.fallback || '').trim()

    if (!raw) {
        return fallback
    }

    if (raw.startsWith('data:') || raw.startsWith('blob:')) {
        return raw
    }

    if (hasAbsoluteProtocol(raw)) {
        return withCloudinaryTransform(toHttpsUrl(raw), options)
    }

    if (raw.startsWith('/')) {
        return raw
    }

    return raw
}
