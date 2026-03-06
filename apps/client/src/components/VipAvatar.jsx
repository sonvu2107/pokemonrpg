import { resolveAvatarUrl } from '../utils/avatarUrl'
import { getVipAvatarFrameUrl } from '../utils/vip'

export default function VipAvatar({
    userLike,
    avatar,
    fallback,
    alt = 'Avatar',
    wrapperClassName = '',
    imageClassName = '',
    frameClassName = '',
    loading = 'lazy',
}) {
    const resolvedAvatar = resolveAvatarUrl(avatar || userLike?.avatar || '', fallback)
    const frameUrl = getVipAvatarFrameUrl(userLike)

    return (
        <div className={`relative ${wrapperClassName}`.trim()}>
            <img
                src={resolvedAvatar}
                alt={alt}
                loading={loading}
                className={imageClassName}
                onError={(event) => {
                    event.currentTarget.onerror = null
                    event.currentTarget.src = resolveAvatarUrl('', fallback)
                }}
            />
            {frameUrl ? (
                <img
                    src={frameUrl}
                    alt="VIP Frame"
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 ${frameClassName}`.trim()}
                    onError={(event) => {
                        event.currentTarget.style.display = 'none'
                    }}
                />
            ) : null}
        </div>
    )
}
