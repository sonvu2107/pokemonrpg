import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import FeatureUnavailableNotice from '../components/FeatureUnavailableNotice'
import { resolvePokemonForm, resolvePokemonSprite } from '../utils/pokemonFormUtils'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-sm uppercase tracking-wide">
        {title}
    </div>
)

export default function ChangePartyPage() {
    const [party, setParty] = useState(Array(6).fill(null))
    const [escrowedPokemon, setEscrowedPokemon] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [swapSourceIndex, setSwapSourceIndex] = useState(null)
    const [swapping, setSwapping] = useState(false)

    const [refreshKey, setRefreshKey] = useState(0)

    useEffect(() => {
        loadParty()
        loadEscrowedPokemon()
    }, [refreshKey])

    const loadParty = async () => {
        try {
            setLoading(true)
            const data = await gameApi.getParty()
            const normalizedParty = Array.from({ length: 6 }, (_, index) => {
                if (!Array.isArray(data)) return null
                return data[index] || null
            })
            setParty(normalizedParty)
            setSwapSourceIndex(null)
            setError(null)
        } catch (err) {
            console.error(err)
            setError('Không thể tải đội hình.')
        } finally {
            setLoading(false)
        }
    }

    const handleSwap = async (fromIndex, toIndex) => {
        if (fromIndex === toIndex) return
        try {
            setSwapping(true)
            await gameApi.swapParty(fromIndex, toIndex)
            setRefreshKey(k => k + 1)
        } catch (err) {
            alert(err.message)
        } finally {
            setSwapping(false)
        }
    }

    const loadEscrowedPokemon = async () => {
        try {
            const data = await gameApi.getEscrowedAuctionPokemon()
            setEscrowedPokemon(Array.isArray(data?.pokemon) ? data.pokemon : [])
        } catch (err) {
            console.error(err)
            setEscrowedPokemon([])
        }
    }

    const handlePickSwap = async (targetIndex) => {
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > 5) return

        if (!Number.isInteger(swapSourceIndex)) {
            if (!party[targetIndex]) return
            setSwapSourceIndex(targetIndex)
            return
        }

        if (swapSourceIndex === targetIndex) {
            setSwapSourceIndex(null)
            return
        }

        await handleSwap(swapSourceIndex, targetIndex)
        setSwapSourceIndex(null)
    }

    const handleRemove = async (pokemonId) => {
        if (!window.confirm('Bạn có chắc muốn bỏ Pokémon này khỏi đội hình?')) return
        try {
            await gameApi.removeFromParty(pokemonId)
            setRefreshKey(k => k + 1)
        } catch (err) {
            alert(err.message)
        }
    }

    const slotNames = [
        'Vị Trí 1', 'Vị Trí 2', 'Vị Trí 3',
        'Vị Trí 4', 'Vị Trí 5', 'Vị Trí 6'
    ]

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12 pt-6">

            <div className="text-center mb-6">
                <h1 className="text-3xl font-bold text-center text-blue-900 drop-shadow-sm">Thay Đổi Đội Hình</h1>
                <FeatureUnavailableNotice
                    compact
                    className="mt-2"
                    title="Restore Party chưa cập nhật"
                    message="Tính năng dọn dẹp nhanh đội hình sẽ được bổ sung ở bản cập nhật tới."
                />
            </div>

            {escrowedPokemon.length > 0 && (
                <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-sm">
                    <div className="text-sm font-bold text-amber-900">Pokémon đang được giữ cho đấu giá</div>
                    <div className="mt-1 text-xs text-amber-800">
                        {escrowedPokemon.length} Pokémon của bạn đang bị khóa tạm thời để phục vụ đấu giá nên sẽ không thể thêm vào đội hình.
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        {escrowedPokemon.map((entry) => (
                            <Link key={entry._id} to="/auctions/manage" className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100">
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide border border-amber-200">Đang giữ cho đấu giá</span>
                                <span>{entry.nickname ? `${entry.nickname} - ${entry.name}` : entry.name}</span>
                                <span>Lv.{Number(entry.level || 1).toLocaleString('vi-VN')}</span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                <SectionHeader title="Thay Đổi Đội Hình" />
                {Number.isInteger(swapSourceIndex) && (
                    <div className="px-4 py-2 text-xs font-bold text-blue-800 bg-blue-50 border-b border-blue-200 text-center">
                        Đã chọn vị trí {swapSourceIndex + 1}. Chọn vị trí khác để đổi chỗ.
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x border-blue-200">
                    {[0, 1, 2].map(index =>
                        <PartySlot
                            key={index}
                            index={index}
                            data={party[index]}
                            label={slotNames[index]}
                            onSwap={handleSwap}
                            onPickSwap={handlePickSwap}
                            onRemove={handleRemove}
                            swapSourceIndex={swapSourceIndex}
                            swapping={swapping}
                        />
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x border-t border-blue-200">
                    {[3, 4, 5].map(index =>
                        <PartySlot
                            key={index}
                            index={index}
                            data={party[index]}
                            label={slotNames[index]}
                            onSwap={handleSwap}
                            onPickSwap={handlePickSwap}
                            onRemove={handleRemove}
                            swapSourceIndex={swapSourceIndex}
                            swapping={swapping}
                        />
                    )}
                </div>
            </div>

            <div className="mt-4 text-center">
                <Link to="/box" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow">
                    + Thêm Pokémon Từ Kho Pokémon
                </Link>
            </div>

        </div>
    )
}

function PartySlot({ index, data, label, onSwap, onPickSwap, onRemove, swapSourceIndex, swapping }) {
    const isFirst = index === 0
    const hasSwapSource = Number.isInteger(swapSourceIndex)
    const isSwapSource = hasSwapSource && swapSourceIndex === index

    if (!data) {
        return (
            <div className="p-4 flex flex-col items-center justify-center min-h-[200px] bg-slate-50 transition-colors hover:bg-white text-center">
                <div className="bg-blue-100/50 w-full mb-4 py-1 text-center font-bold text-blue-800 text-xs uppercase border-y border-blue-200">
                    {label}
                </div>
                <div className="w-16 h-16 rounded-full bg-slate-200 border-2 border-slate-300 flex items-center justify-center mb-2 opacity-50">
                    <img src="/pokeball_icon.png" alt="Empty" className="w-8 h-8 opacity-50" onError={e => e.target.style.display = 'none'} />
                </div>
                <div className="text-sm font-bold text-slate-500">None</div>
                <div className="text-xs text-slate-400 mt-1">Level: 1</div>
                <div className="text-xs text-slate-400">HP: 0/0</div>

                {hasSwapSource && (
                    <button
                        onClick={() => onPickSwap(index)}
                        disabled={swapping}
                        className="mt-4 text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline uppercase disabled:opacity-60"
                    >
                        [ Chuyển Vào Ô Này ]
                    </button>
                )}

            </div>
        )
    }

    const species = data.pokemonId || {}
    const { formId, formName } = resolvePokemonForm(species, data.formId)
    const sprite = resolvePokemonSprite({
        species,
        formId,
        isShiny: Boolean(data.isShiny),
        fallback: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png',
    })

    return (
        <div className="p-4 flex flex-col items-center min-h-[200px] bg-white transition-colors hover:bg-blue-50 text-center relative group">
            <div className="bg-blue-100/50 w-full mb-4 py-1 text-center font-bold text-blue-800 text-xs uppercase border-y border-blue-200">
                {label}
            </div>

            <button
                onClick={() => onRemove(data._id)}
                className="absolute top-12 right-2 text-slate-300 hover:text-red-500 font-bold p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove from party"
            >
                ✕
            </button>

            <Link to={`/pokemon/${data._id}`} className="relative w-20 h-20 flex items-center justify-center mb-1 hover:scale-110 transition-transform">
                <img
                    src={sprite}
                    alt={species.name}
                    className="max-w-full max-h-full pixelated rendering-pixelated"
                    onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                    }}
                />
            </Link>

            <div className="text-sm font-bold text-blue-900">
                {data.nickname || species.name}
            </div>
            {formId !== 'normal' && (
                <div className="text-[10px] font-bold text-sky-700 uppercase">
                    {formName}
                </div>
            )}
            <div className="text-xs font-bold text-slate-600">
                Level: {data.level}
            </div>
            <div className="text-xs text-slate-500">
                EXP: {data.experience}/{250 + Math.max(0, data.level - 1) * 100}
            </div>
            <div className="text-xs text-slate-500">
                HP: {data.stats ? `${data.stats.hp}/${data.stats.hp}` : '?/?'}
            </div>
            <div className="text-xs text-slate-500">
                ATK: {data.stats?.atk || '?'} | DEF: {data.stats?.def || '?'}
            </div>

            <button
                onClick={() => onPickSwap(index)}
                disabled={swapping}
                className={`mt-2 text-[10px] font-bold hover:underline uppercase disabled:opacity-60 ${
                    isSwapSource ? 'text-amber-600 hover:text-amber-700' : 'text-blue-600 hover:text-blue-800'
                }`}
            >
                {isSwapSource
                    ? '[ Hủy Chọn ]'
                    : (hasSwapSource ? `[ Đổi Với Vị Trí ${swapSourceIndex + 1} ]` : '[ Chọn Đổi Chỗ ]')}
            </button>

            {!isFirst && (
                <button
                    onClick={() => onSwap(index, 0)}
                    disabled={swapping}
                    className="mt-2 text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline uppercase disabled:opacity-60"
                >
                    [ Chuyển Lên Đầu ]
                </button>
            )}
            {isFirst && (
                <div className="mt-4 text-[10px] font-bold text-slate-400 uppercase cursor-default">
                    Đội Trưởng
                </div>
            )}
        </div>
    )
}
