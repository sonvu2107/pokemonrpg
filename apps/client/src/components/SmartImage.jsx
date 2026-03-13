import { useEffect, useMemo, useState } from 'react'
import { getImageUrl } from '../utils/imageUrl'

const DEFAULT_IMAGE_FALLBACK = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
const DEFAULT_TRANSFORM_QUALITY = 'auto:eco'

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
    transformHeight = 0,
    transformQuality = DEFAULT_TRANSFORM_QUALITY,
    transformFormat = 'auto',
    transformDpr = 'auto',
    transformCrop = 'limit',
    cloudinaryTransform = '',
    onError,
    ...rest
}) {
    const effectiveTransformWidth = Number(transformWidth) > 0 ? Number(transformWidth) : Number(width) || 0
    const effectiveTransformHeight = Number(transformHeight) > 0 ? Number(transformHeight) : 0
    const effectiveTransformQuality = String(transformQuality || '').trim() || DEFAULT_TRANSFORM_QUALITY

    const normalizedFallback = useMemo(() => {
        return getImageUrl(fallback, {
            fallback: DEFAULT_IMAGE_FALLBACK,
            width: effectiveTransformWidth,
            height: effectiveTransformHeight,
            quality: effectiveTransformQuality,
            format: transformFormat,
            dpr: transformDpr,
            crop: transformCrop,
            extraTransform: cloudinaryTransform,
        })
    }, [fallback, effectiveTransformWidth, effectiveTransformHeight, effectiveTransformQuality, transformFormat, transformDpr, transformCrop, cloudinaryTransform])

    const [resolvedSrc, setResolvedSrc] = useState(() => {
        return getImageUrl(src, {
            fallback: normalizedFallback,
            width: effectiveTransformWidth,
            height: effectiveTransformHeight,
            quality: effectiveTransformQuality,
            format: transformFormat,
            dpr: transformDpr,
            crop: transformCrop,
            extraTransform: cloudinaryTransform,
        })
    })

    useEffect(() => {
        setResolvedSrc(getImageUrl(src, {
            fallback: normalizedFallback,
            width: effectiveTransformWidth,
            height: effectiveTransformHeight,
            quality: effectiveTransformQuality,
            format: transformFormat,
            dpr: transformDpr,
            crop: transformCrop,
            extraTransform: cloudinaryTransform,
        }))
    }, [src, normalizedFallback, effectiveTransformWidth, effectiveTransformHeight, effectiveTransformQuality, transformFormat, transformDpr, transformCrop, cloudinaryTransform])

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
