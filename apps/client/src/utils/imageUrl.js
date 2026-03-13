const CLOUDINARY_UPLOAD_MARKER = '/image/upload/'
const WIDTH_BUCKETS = [32, 48, 64, 80, 96, 128, 160, 240, 320, 480, 640, 960]
const MANAGED_TRANSFORM_PREFIXES = ['f_', 'q_', 'dpr_', 'c_', 'w_', 'h_']

const hasAbsoluteProtocol = (value = '') => /^(https?:)?\/\//i.test(value)

const toHttpsUrl = (value = '') => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (raw.startsWith('//')) return `https:${raw}`
    return raw
}

const normalizeBucketedDimension = (value = 0) => {
    const normalized = Math.round(Number(value) || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) return 0

    for (const bucket of WIDTH_BUCKETS) {
        if (normalized <= bucket) {
            return bucket
        }
    }

    return WIDTH_BUCKETS[WIDTH_BUCKETS.length - 1]
}

const normalizeTransformValue = (value = '', prefix = '', fallback = '') => {
    const normalized = String(value || fallback).trim()
    if (!normalized) return ''
    return normalized.startsWith(`${prefix}_`) ? normalized : `${prefix}_${normalized}`
}

const normalizeExtraTransform = (value = '') => {
    return String(value || '')
        .trim()
        .replace(/^,+|,+$/g, '')
        .replace(/\s+/g, '')
}

const isCloudinaryUrl = (value = '') => {
    return value.includes('res.cloudinary.com') && value.includes(CLOUDINARY_UPLOAD_MARKER)
}

const isAnimatedGif = (value = '') => {
    try {
        const pathname = new URL(value).pathname.toLowerCase()
        return pathname.endsWith('.gif')
    } catch {
        return false
    }
}

const isTransformationSegment = (segment = '') => {
    const normalized = String(segment || '').trim()
    if (!normalized || /^v\d+$/.test(normalized)) return false
    return MANAGED_TRANSFORM_PREFIXES.some((prefix) => normalized.includes(prefix))
}

const buildCloudinaryTransform = ({
    width = 0,
    height = 0,
    crop = 'limit',
    quality = 'auto:eco',
    format = 'auto',
    dpr = 'auto',
    extraTransform = '',
} = {}) => {
    const parts = [
        normalizeTransformValue(format, 'f', 'auto'),
        normalizeTransformValue(quality, 'q', 'auto:eco'),
        normalizeTransformValue(dpr, 'dpr', 'auto'),
        normalizeTransformValue(crop, 'c', 'limit'),
    ]
    const normalizedWidth = normalizeBucketedDimension(width)
    const normalizedHeight = normalizeBucketedDimension(height)
    const normalizedExtra = normalizeExtraTransform(extraTransform)

    if (normalizedWidth > 0) {
        parts.push(`w_${normalizedWidth}`)
    }

    if (normalizedHeight > 0) {
        parts.push(`h_${normalizedHeight}`)
    }

    if (normalizedExtra) {
        parts.push(normalizedExtra)
    }

    return parts.filter(Boolean).join(',')
}

export const withCloudinaryTransform = (value = '', options = {}) => {
    const raw = toHttpsUrl(value)
    if (!raw || !isCloudinaryUrl(raw) || isAnimatedGif(raw)) {
        return raw
    }

    const [prefix, suffix] = raw.split(CLOUDINARY_UPLOAD_MARKER)
    if (!prefix || !suffix) {
        return raw
    }

    const firstSegment = suffix.split('/')[0] || ''
    if (isTransformationSegment(firstSegment)) {
        return raw
    }

    const transform = buildCloudinaryTransform(options)
    if (!transform) return raw

    return `${prefix}${CLOUDINARY_UPLOAD_MARKER}${transform}/${suffix.replace(/^\/+/, '')}`
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
