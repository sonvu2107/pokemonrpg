import { useEffect, useMemo, useState } from 'react'
import { getImageUrl } from '../utils/imageUrl'

const DEFAULT_IMAGE_FALLBACK = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'

export default function SmartImage({
    src,
    alt = '',
    className = '',
    fallback = DEFAULT_IMAGE_FALLBACK,
    width,
    height,
    loading = 'lazy',
    decoding = 'async',
    transformWidth = 0,
    transformQuality = 'auto',
    cloudinaryTransform = '',
    onError,
    ...rest
}) {
    const normalizedFallback = useMemo(() => {
        return getImageUrl(fallback, {
            fallback: DEFAULT_IMAGE_FALLBACK,
            width: transformWidth,
            quality: transformQuality,
            extraTransform: cloudinaryTransform,
        })
    }, [fallback, transformWidth, transformQuality, cloudinaryTransform])

    const [resolvedSrc, setResolvedSrc] = useState(() => {
        return getImageUrl(src, {
            fallback: normalizedFallback,
            width: transformWidth,
            quality: transformQuality,
            extraTransform: cloudinaryTransform,
        })
    })

    useEffect(() => {
        setResolvedSrc(getImageUrl(src, {
            fallback: normalizedFallback,
            width: transformWidth,
            quality: transformQuality,
            extraTransform: cloudinaryTransform,
        }))
    }, [src, normalizedFallback, transformWidth, transformQuality, cloudinaryTransform])

    return (
        <img
            src={resolvedSrc || normalizedFallback}
            alt={alt}
            width={width}
            height={height}
            loading={loading}
            decoding={decoding}
            className={className}
            onError={(event) => {
                event.currentTarget.onerror = null
                setResolvedSrc(normalizedFallback)
                onError?.(event)
            }}
            {...rest}
        />
    )
}
