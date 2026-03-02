import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import FeatureUnavailableNotice from '../components/FeatureUnavailableNotice'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-sm uppercase tracking-wide">
        {title}
    </div>
)

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const InfoRow = ({ label, value, valueClass = '' }) => (
    <div className="flex border-b border-blue-200 last:border-0 text-xs">
        <div className="w-1/3 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
            {label}:
        </div>
        <div className={`w-2/3 p-2 font-bold text-slate-700 flex items-center ${valueClass}`}>
            {value}
        </div>
    </div>
)

const StatRow = ({ label, value, label2, value2 }) => (
    <div className="flex border-b border-blue-200 last:border-0 text-xs">
        {/* Col 1 */}
        <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
            {label}:
        </div>
        <div className="w-1/3 p-2 font-bold text-slate-700 border-r border-blue-200 flex items-center justify-center">
            {value}
        </div>

        {/* Col 2 */}
        {label2 && (
            <>
                <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
                    {label2}:
                </div>
                <div className="w-1/3 p-2 font-bold text-slate-700 flex items-center justify-center">
                    {value2}
                </div>
            </>
        )}
    </div>
)

export default function PokemonInfoPage() {
    const { id } = useParams()
    const [pokemon, setPokemon] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [featureNotice, setFeatureNotice] = useState('')

    useEffect(() => {
        loadPokemon()
    }, [id])

    const loadPokemon = async () => {
        try {
            setLoading(true)
            setError(null)
            setFeatureNotice('')
            const data = await gameApi.getPokemonDetail(id)
            setPokemon(data)
        } catch (err) {
            console.error(err)
            setError('Không tìm thấy thông tin Pokemon hoặc có lỗi xảy ra.')
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-blue-800 font-bold">Đang tải thông tin Pokemon...</p>
            </div>
        )
    }

    if (error || !pokemon) {
        return (
            <div className="max-w-4xl mx-auto p-8 text-center">
                <div className="text-red-500 font-bold text-lg mb-4">⚠️ {error || 'Pokemon không tồn tại'}</div>
                <Link to="/box" className="text-blue-600 hover:underline">Quay lại Kho Pokemon</Link>
            </div>
        )
    }

    const base = pokemon.pokemonId
    const forms = Array.isArray(base?.forms) ? base.forms : []
    const resolvedFormId = normalizeFormId(pokemon.formId || base?.defaultFormId || 'normal')
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === resolvedFormId) || null
    const resolvedFormName = String(resolvedForm?.formName || resolvedForm?.formId || resolvedFormId).trim()
    const formNormalSprite = resolvedForm?.imageUrl || resolvedForm?.sprites?.normal || resolvedForm?.sprites?.icon || base?.imageUrl || base?.sprites?.normal || base?.sprites?.icon || ''
    const formShinySprite = resolvedForm?.sprites?.shiny || base?.sprites?.shiny || formNormalSprite
    const stats = pokemon.stats
    const sprite = pokemon.isShiny ? formShinySprite : formNormalSprite
    const previousPokemon = pokemon.evolution?.previousPokemon || null
    const previousSprite = previousPokemon?.sprites?.normal || ''
    const ownerAvatar = String(pokemon.userId?.avatar || '').trim() || DEFAULT_AVATAR
    const serverStats = pokemon.serverStats || {}
    const hasServerStats = Object.prototype.hasOwnProperty.call(serverStats, 'speciesTotal')
    const speciesTotal = Number(serverStats.speciesTotal) || 0
    const speciesRank = Number(serverStats.speciesRank)
    const totalPokemonInServer = Number(serverStats.totalPokemon) || 0

    // Format rarity
    const rarityColor = {
        d: 'text-slate-500',
        c: 'text-green-600',
        b: 'text-blue-600',
        a: 'text-purple-600',
        s: 'text-orange-500',
        ss: 'text-red-600',
        sss: 'text-yellow-500'
    }[base.rarity] || 'text-slate-700'

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12 pt-6">

            {/* Main Card */}
            <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">

                {/* Header */}
                <SectionHeader title={`Thông Tin Pokemon ${base.name} (ID #${base.pokedexNumber})`} />
                <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase bg-blue-100/50">
                    Tổng Quan
                </div>

                {/* Content Container */}
                <div className="p-4">

                    {/* Sprite & Basic Info */}
                    <div className="flex flex-col items-center mb-6">
                        <div className="relative w-32 h-32 flex items-center justify-center mb-2">
                            <img
                                src={sprite}
                                alt={base.name}
                                className="max-w-full max-h-full pixelated rendering-pixelated scale-125"
                                onError={(e) => {
                                    e.target.onerror = null
                                    e.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                }}
                            />
                            {previousPokemon && previousSprite && (
                                <img
                                    src={previousSprite}
                                    alt={previousPokemon.name}
                                    className="absolute -right-16 top-1/2 -translate-y-1/2 w-14 h-14 object-contain pixelated opacity-90"
                                    onError={(e) => {
                                        e.target.onerror = null
                                        e.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                    }}
                                />
                            )}
                            {/* Small icon maybe? */}
                        </div>

                        <h2 className="text-xl font-bold text-blue-900 flex items-center gap-2">
                            {pokemon.nickname || base.name}
                            {pokemon.isShiny && <span className="text-amber-500 text-sm">★</span>}
                            {resolvedFormId !== 'normal' && (
                                <span className="text-[11px] uppercase bg-sky-100 text-sky-700 px-2 py-0.5 rounded border border-sky-200">
                                    {resolvedFormName}
                                </span>
                            )}
                        </h2>

                        <div className="text-xs font-bold mt-1 flex gap-2">
                            <span className="bg-slate-200 px-2 py-0.5 rounded text-slate-700">Lv. {pokemon.level}</span>
                            <span className={`bg-slate-100 px-2 py-0.5 rounded uppercase ${rarityColor}`}>
                                {base.rarity.toUpperCase()}
                            </span>
                        </div>

                        {/* Experience Bar? Optional */}
                    </div>

                    {/* Owner Section */}
                    <div className="border border-blue-300 rounded mb-4 overflow-hidden">
                        <div className="bg-blue-100/50 p-1 text-center text-xs font-bold text-blue-800 border-b border-blue-200">
                            Chủ Sở Hữu
                        </div>
                        <div className="p-2 text-center text-sm font-bold text-slate-700 flex flex-col items-center">
                            <img
                                src={ownerAvatar}
                                alt={pokemon.userId?.username || 'Unknown'}
                                className="w-10 h-10 rounded-full border border-blue-200 object-cover bg-slate-100 mb-1"
                                onError={(e) => {
                                    e.currentTarget.onerror = null
                                    e.currentTarget.src = DEFAULT_AVATAR
                                }}
                            />
                            <span className="text-blue-600">{pokemon.userId?.username || 'Unknown'}</span>
                            <span className="text-[10px] text-slate-400">ID: {pokemon.userId?._id?.slice(-8).toUpperCase()}</span>
                        </div>
                    </div>

                    {/* Stats Table */}
                    <div className="border border-blue-300 rounded overflow-hidden mb-4">
                        <div className="bg-blue-100/50 p-1 text-center text-xs font-bold text-blue-800 border-b border-blue-200">
                            Chỉ Số Pokemon
                        </div>

                        <StatRow
                            label="Max HP" value={stats.maxHp}
                            label2="Attack" value2={stats.atk}
                        />
                        <StatRow
                            label="Defense" value={stats.def}
                            label2="Sp. Atk" value2={stats.spatk}
                        />
                        <StatRow
                            label="Sp. Def" value={stats.spdef}
                            label2="Speed" value2={stats.spd}
                        />

                        {/* Extra info row */}
                        <div className="flex border-b border-blue-200 last:border-0 text-xs">
                            <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
                                Vật phẩm:
                            </div>
                            <div className="w-1/3 p-2 font-bold text-slate-700 border-r border-blue-200 flex items-center justify-center">
                                {pokemon.heldItem || 'Không'}
                            </div>
                            <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
                                Thắng:
                            </div>
                            <div className="w-1/3 p-2 font-bold text-slate-700 flex items-center justify-center">
                                ? (0 thua)
                            </div>
                        </div>

                        {/* Moves */}
                        <div className="flex border-b border-blue-200 last:border-0 text-xs text-center">
                            {(pokemon.moves || []).length > 0 ? (
                                <>
                                    <div className="w-1/4 p-2 border-r border-blue-200 font-bold text-slate-700">
                                        {pokemon.moves[0] || '-'}
                                    </div>
                                    <div className="w-1/4 p-2 border-r border-blue-200 font-bold text-slate-700">
                                        {pokemon.moves[1] || '-'}
                                    </div>
                                    <div className="w-1/4 p-2 border-r border-blue-200 font-bold text-slate-700">
                                        {pokemon.moves[2] || '-'}
                                    </div>
                                    <div className="w-1/4 p-2 font-bold text-slate-700">
                                        {pokemon.moves[3] || '-'}
                                    </div>
                                </>
                            ) : (
                                <div className="w-full p-2 italic text-slate-400">Chưa học kỹ năng nào</div>
                            )}
                        </div>
                    </div>

                    {/* Origin Section */}
                    <div className="border border-blue-300 rounded overflow-hidden">
                        <div className="flex text-xs text-center">
                            <div className="w-1/2 bg-blue-100/50 p-1 font-bold text-blue-800 border-r border-blue-200 border-b">
                                Người Bắt Đầu Tiên
                            </div>
                            <div className="w-1/2 bg-blue-100/50 p-1 font-bold text-blue-800 border-b border-blue-200">
                                Nơi Bắt
                            </div>
                        </div>
                        <div className="flex text-xs text-center text-slate-700 font-bold">
                            <div className="w-1/2 p-2 border-r border-blue-200">
                                {pokemon.originalTrainer || pokemon.userId?.username || 'Unknown'}
                            </div>
                            <div className="w-1/2 p-2">
                                {pokemon.originalTrainer ? 'Trao đổi' : 'Bắt hoang dã'}
                                {/* logic for place obtained is vague in schema, using fallback */}
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Footer Stats similar to screenshot */}
            <div className="mt-4 border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white text-center">
                <div className="bg-blue-100/50 p-1 font-bold text-blue-800 text-xs border-b border-blue-200 uppercase">
                    Số Lượng Trong Server
                </div>
                <div className="p-2 text-xs font-bold text-blue-900">
                    {hasServerStats ? (
                        <>
                            <span className="text-slate-500">Loài này:</span> {speciesTotal.toLocaleString('vi-VN')}
                            {' '}
                            <span className="text-slate-400">[Hạng: {Number.isFinite(speciesRank) && speciesRank > 0 ? `#${speciesRank}` : 'Chưa có'}]</span>
                            {' '}
                            <span className="text-slate-500">| Tổng Pokémon:</span> {totalPokemonInServer.toLocaleString('vi-VN')}
                        </>
                    ) : (
                        <FeatureUnavailableNotice
                            compact
                            title="Số lượng trong server chưa cập nhật"
                            message="Dữ liệu thống kê máy chủ chưa sẵn sàng ở phiên bản này."
                        />
                    )}
                </div>
            </div>

            <div className="mt-4 text-center text-xs font-bold text-blue-800 space-x-4">
                <Link to="/rankings/pokemon" className="hover:underline hover:text-red-500">Bảng Xếp Hạng Pokémon</Link>
                <button
                    type="button"
                    onClick={() => setFeatureNotice('Tính năng Xếp Hạng Theo Loài chưa được cập nhật.')}
                    className="hover:underline hover:text-red-500"
                >
                    Xếp Hạng Theo Loài
                </button>
                <button
                    type="button"
                    onClick={() => setFeatureNotice('Tính năng Lịch Sử Pokémon chưa được cập nhật.')}
                    className="hover:underline hover:text-red-500"
                >
                    Lịch Sử Pokémon
                </button>
            </div>

            {featureNotice && (
                <FeatureUnavailableNotice
                    className="mt-2"
                    message={featureNotice}
                />
            )}

        </div>
    )
}
