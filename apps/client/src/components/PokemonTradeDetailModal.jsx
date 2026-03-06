const TYPE_LABEL_MAP = {
    normal: 'Thường',
    fire: 'Lửa',
    water: 'Nước',
    grass: 'Cỏ',
    electric: 'Điện',
    ice: 'Băng',
    fighting: 'Giác đấu',
    poison: 'Độc',
    ground: 'Đất',
    flying: 'Bay',
    psychic: 'Siêu linh',
    bug: 'Côn trùng',
    rock: 'Đá',
    ghost: 'Ma',
    dragon: 'Rồng',
    dark: 'Bóng tối',
    steel: 'Thép',
    fairy: 'Tiên',
}

const formatDate = (value) => {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleString('vi-VN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

const normalizeTypes = (types) => {
    if (!Array.isArray(types)) return []
    return types
        .map((type) => String(type || '').trim().toLowerCase())
        .filter(Boolean)
}

const buildStatusLabel = (status) => {
    const normalized = String(status || '').trim().toLowerCase()
    if (normalized === 'active') return 'Đang bán'
    if (normalized === 'sold') return 'Đã bán'
    if (normalized === 'cancelled') return 'Đã hủy'
    return normalized || '--'
}

export default function PokemonTradeDetailModal({
    open,
    onClose,
    title = 'Chi tiết Pokémon',
    pokemon = null,
}) {
    if (!open || !pokemon) return null

    const sprite = pokemon?.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
    const displayName = pokemon?.pokemonName || pokemon?.speciesName || 'Pokemon'
    const speciesName = pokemon?.speciesName || '--'
    const formName = pokemon?.formName || pokemon?.formId || 'normal'
    const isNormalForm = String(pokemon?.formId || 'normal').trim().toLowerCase() === 'normal'
    const types = normalizeTypes(pokemon?.type)

    return (
        <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4 animate-fadeIn"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-lg border border-slate-200 p-4 sm:p-6 w-full max-w-[94vw] sm:max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                    <h3 className="text-lg font-bold text-slate-800">{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center gap-3 rounded border border-blue-200 bg-blue-50 p-3">
                        <img
                            src={sprite}
                            alt={speciesName}
                            className="w-20 h-20 object-contain pixelated"
                            onError={(event) => {
                                event.currentTarget.onerror = null
                                event.currentTarget.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                            }}
                        />
                        <div>
                            <div className="text-lg font-bold text-slate-900">{displayName}</div>
                            <div className="text-sm text-slate-600">Loài: {speciesName}</div>
                            <div className="text-sm text-slate-600">Cấp độ: Lv.{Math.max(1, Number(pokemon?.level) || 1)}</div>
                            {!isNormalForm && (
                                <div className="text-xs text-sky-700 font-bold uppercase mt-1">Dạng: {formName}</div>
                            )}
                        </div>
                    </div>

                    {types.length > 0 && (
                        <div>
                            <div className="text-xs font-bold text-slate-700 mb-1 uppercase">Hệ</div>
                            <div className="flex flex-wrap gap-1.5">
                                {types.map((type) => (
                                    <span
                                        key={`${displayName}-${type}`}
                                        className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-800 text-xs font-bold"
                                    >
                                        {TYPE_LABEL_MAP[type] || type}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                        {Number.isFinite(Number(pokemon?.price)) && (
                            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-xs text-slate-500 uppercase">Giá</div>
                                <div className="font-bold text-slate-800">{Number(pokemon.price || 0).toLocaleString('vi-VN')} xu</div>
                            </div>
                        )}

                        {pokemon?.seller?.username && (
                            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-xs text-slate-500 uppercase">Người bán</div>
                                <div className="font-bold text-slate-800 break-words">{pokemon.seller.username}</div>
                            </div>
                        )}

                        {pokemon?.buyer?.username && (
                            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-xs text-slate-500 uppercase">Người mua</div>
                                <div className="font-bold text-slate-800 break-words">{pokemon.buyer.username}</div>
                            </div>
                        )}

                        {pokemon?.otName && (
                            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-xs text-slate-500 uppercase">OT</div>
                                <div className="font-bold text-slate-800 break-words">{pokemon.otName}</div>
                            </div>
                        )}

                        {pokemon?.status && (
                            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                                <div className="text-xs text-slate-500 uppercase">Trạng thái</div>
                                <div className="font-bold text-slate-800">{buildStatusLabel(pokemon.status)}</div>
                            </div>
                        )}

                        {(pokemon?.listedAt || pokemon?.soldAt) && (
                            <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 sm:col-span-2">
                                {pokemon?.listedAt && (
                                    <div>
                                        <span className="text-xs text-slate-500 uppercase">Đăng bán:</span>{' '}
                                        <span className="text-slate-700 font-medium">{formatDate(pokemon.listedAt)}</span>
                                    </div>
                                )}
                                {pokemon?.soldAt && (
                                    <div>
                                        <span className="text-xs text-slate-500 uppercase">Đã bán:</span>{' '}
                                        <span className="text-slate-700 font-medium">{formatDate(pokemon.soldAt)}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
