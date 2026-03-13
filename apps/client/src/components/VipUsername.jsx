import { getVipUsernameConfig } from '../utils/vip'

const joinClassNames = (...parts) => parts.filter(Boolean).join(' ')

const hexToRgba = (hexColor = '', alpha = 1) => {
    const normalized = String(hexColor || '').trim().replace('#', '')
    if (normalized.length !== 6) return `rgba(15, 23, 42, ${alpha})`

    const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${Math.max(0, Math.min(1, Number(alpha) || 0))})`
}

const buildAnimatedGradient = (palette = []) => {
    const colors = Array.isArray(palette) ? palette.filter(Boolean) : []
    if (colors.length === 0) return ''
    if (colors.length === 1) return `linear-gradient(90deg, ${colors[0]} 0%, ${colors[0]} 100%)`

    const steps = colors.map((color, index) => {
        const position = Math.round((index / (colors.length - 1)) * 100)
        return `${color} ${position}%`
    })

    return `linear-gradient(90deg, ${steps.join(', ')})`
}

export default function VipUsername({
    as: Component = 'span',
    userLike,
    className = '',
    style = {},
    children,
    ...props
}) {
    const vipUsername = getVipUsernameConfig(userLike)
    const resolvedStyle = {
        ...style,
    }

    if (vipUsername.isAnimated) {
        const glowColor = hexToRgba(vipUsername.color, 0.42)
        resolvedStyle.backgroundImage = buildAnimatedGradient(vipUsername.palette)
        resolvedStyle.backgroundSize = `${Math.max(220, vipUsername.palette.length * 70)}% 100%`
        resolvedStyle.backgroundClip = 'text'
        resolvedStyle.WebkitBackgroundClip = 'text'
        resolvedStyle.color = 'transparent'
        resolvedStyle.WebkitTextFillColor = 'transparent'
        resolvedStyle.textShadow = `0 0 12px ${glowColor}`
    } else if (vipUsername.isColored) {
        resolvedStyle.color = vipUsername.color
        resolvedStyle.textShadow = `0 0 10px ${hexToRgba(vipUsername.color, 0.18)}`
    }

    return (
        <Component
            className={joinClassNames(className, vipUsername.isAnimated ? 'vip-username-animated' : '')}
            style={resolvedStyle}
            {...props}
        >
            {children}
        </Component>
    )
}
