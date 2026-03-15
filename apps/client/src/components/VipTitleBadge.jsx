import { getVipTitle, getVipTitleImageUrl } from '../utils/vip'
import { toDeliveryUrl } from '../utils/imageUrl'

export const VIP_TITLE_IMAGE_CLASS = 'h-8 max-w-[240px] object-contain shrink-0'
export const VIP_TITLE_TEXT_CLASS = 'text-sm font-bold text-amber-600 truncate max-w-[240px] shrink-0'
const VIP_TITLE_RENDER_TRANSFORMATION = 'e_trim,c_pad,w_960,h_320,b_transparent,f_auto,q_auto'

const normalizeCloudinaryTitleUrl = (url = '') => {
    const raw = String(url || '').trim()
    if (!raw) return ''

    if (!/(res\.cloudinary\.com|cdn\.vnpet\.games)/i.test(raw)) return toDeliveryUrl(raw)

    const marker = '/image/upload/'
    if (!raw.includes(marker)) return toDeliveryUrl(raw)

    const transformedMarker = `${marker}${VIP_TITLE_RENDER_TRANSFORMATION}/`
    if (raw.includes(transformedMarker)) return toDeliveryUrl(raw)

    const [prefix, suffix] = raw.split(marker)
    if (!prefix || !suffix) return toDeliveryUrl(raw)

    return toDeliveryUrl(`${prefix}${marker}${VIP_TITLE_RENDER_TRANSFORMATION}/${suffix}`)
}

export default function VipTitleBadge({
    userLike,
    fallback = 'none',
    imageClassName = VIP_TITLE_IMAGE_CLASS,
    textClassName = VIP_TITLE_TEXT_CLASS,
}) {
    const vipTitle = getVipTitle(userLike)
    const vipTitleImageUrl = getVipTitleImageUrl(userLike)
    const normalizedTitleImageUrl = normalizeCloudinaryTitleUrl(vipTitleImageUrl)

    if (normalizedTitleImageUrl) {
        return (
            <img
                src={normalizedTitleImageUrl}
                alt={vipTitle || 'Danh hiệu VIP'}
                className={imageClassName}
                onError={(event) => {
                    event.currentTarget.style.display = 'none'
                }}
            />
        )
    }

    if (vipTitle) {
        return <span className={textClassName}>{vipTitle}</span>
    }

    if (fallback === 'dash') {
        return <span className={textClassName}>--</span>
    }

    return null
}
