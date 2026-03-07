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

    if (frameUrl) {
        return (
            <div className={`relative ${wrapperClassName}`.trim()}>
                <div className="absolute inset-[16%] rounded-full overflow-hidden">
                    <img
                        src={resolvedAvatar}
                        alt={alt}
                        loading={loading}
                        decoding="async"
                        className={imageClassName}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(event) => {
                            event.currentTarget.onerror = null
                            event.currentTarget.src = resolveAvatarUrl('', fallback)
                        }}
                    />
                </div>
                <img
                    src={frameUrl}
                    alt="VIP Frame"
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-0 scale-[1.2] ${frameClassName}`.trim()}
                    onError={(event) => {
                        event.currentTarget.style.display = 'none'
                    }}
                />
            </div>
        )
    }

    return (
        <div className={`relative rounded-full overflow-hidden ${wrapperClassName}`.trim()}>
            <img
                src={resolvedAvatar}
                alt={alt}
                loading={loading}
                decoding="async"
                className={imageClassName}
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '9999px' }}
                onError={(event) => {
                    event.currentTarget.onerror = null
                    event.currentTarget.src = resolveAvatarUrl('', fallback)
                }}
            />
        </div>
    )
}
