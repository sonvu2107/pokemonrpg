export default function VipCaughtStar({ level = 0, className = '', title = '' }) {
    const normalizedLevel = Math.max(0, Number(level) || 0)
    if (normalizedLevel <= 0) return null

    return (
        <span
            className={`inline-flex items-center text-amber-500 drop-shadow-sm ${className}`.trim()}
            title={title || `Pokemon bắt từ map VIP ${normalizedLevel}`}
            aria-label={title || `Pokemon bắt từ map VIP ${normalizedLevel}`}
        >
            ★
        </span>
    )
}
