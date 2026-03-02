export default function FeatureUnavailableNotice({
    title = 'Tính năng chưa cập nhật',
    message = 'Tính năng này đang được phát triển. Vui lòng quay lại sau.',
    compact = false,
    className = '',
}) {
    const wrapperClasses = compact
        ? 'rounded border-2 border-blue-300 bg-gradient-to-b from-white to-blue-50 p-2'
        : 'rounded-lg border-2 border-blue-400 bg-gradient-to-b from-white to-blue-50 p-3 shadow-sm'

    return (
        <div className={`${wrapperClasses} ${className}`.trim()} role="status" aria-live="polite">
            <div className="flex items-start gap-2.5">
                <img
                    src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                    alt="Thông báo"
                    className={compact ? 'w-5 h-5 mt-0.5 pixelated' : 'w-6 h-6 mt-0.5 pixelated'}
                />
                <div>
                    <div className={compact ? 'text-[11px] font-extrabold uppercase text-blue-800' : 'text-xs font-extrabold uppercase text-blue-800'}>
                        {title}
                    </div>
                    <div className={compact ? 'text-[11px] text-slate-700 leading-snug' : 'text-xs text-slate-700 leading-relaxed'}>
                        {message}
                    </div>
                </div>
            </div>
        </div>
    )
}
