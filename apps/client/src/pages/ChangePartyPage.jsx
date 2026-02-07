import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-sm uppercase tracking-wide">
        {title}
    </div>
)

export default function ChangePartyPage() {
    const [party, setParty] = useState(Array(6).fill(null))
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    // For refreshing data
    const [refreshKey, setRefreshKey] = useState(0)

    useEffect(() => {
        loadParty()
    }, [refreshKey])

    const loadParty = async () => {
        try {
            setLoading(true)
            const data = await gameApi.getParty()
            setParty(data)
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
            await gameApi.swapParty(fromIndex, toIndex)
            setRefreshKey(k => k + 1) // Reload to get synced state
        } catch (err) {
            alert(err.message)
        }
    }

    const handleRemove = async (pokemonId) => {
        if (!window.confirm('Bạn có chắc muốn bỏ Pokemon này khỏi đội hình?')) return
        try {
            await gameApi.removeFromParty(pokemonId)
            setRefreshKey(k => k + 1)
        } catch (err) {
            alert(err.message)
        }
    }

    // Slots names as per screenshot
    const slotNames = [
        'Vị Trí 1', 'Vị Trí 2', 'Vị Trí 3',
        'Vị Trí 4', 'Vị Trí 5', 'Vị Trí 6'
    ]

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12 pt-6">

            <div className="text-center mb-6">
                <h1 className="text-3xl font-bold text-center text-blue-900 drop-shadow-sm">Thay Đổi Đội Hình</h1>
                <p className="text-slate-600 text-xs font-bold mt-2">
                    Để dọn dẹp đội hình, hãy sử dụng tính năng "Restore Party" (chưa có).
                </p>
            </div>

            <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                <SectionHeader title="Thay Đổi Đội Hình" />

                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x border-blue-200">
                    {/* Top Row: 0, 1, 2 */}
                    {[0, 1, 2].map(index =>
                        <PartySlot
                            key={index}
                            index={index}
                            data={party[index]}
                            label={slotNames[index]}
                            onSwap={handleSwap}
                            onRemove={handleRemove}
                        />
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x border-t border-blue-200">
                    {/* Bottom Row: 3, 4, 5 */}
                    {[3, 4, 5].map(index =>
                        <PartySlot
                            key={index}
                            index={index}
                            data={party[index]}
                            label={slotNames[index]}
                            onSwap={handleSwap}
                            onRemove={handleRemove}
                        />
                    )}
                </div>
            </div>

            <div className="mt-4 text-center">
                <Link to="/box" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow">
                    + Thêm Pokemon Từ Kho Pokemon
                </Link>
            </div>

        </div>
    )
}

function PartySlot({ index, data, label, onSwap, onRemove }) {
    const isFirst = index === 0

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

            </div>
        )
    }

    const species = data.pokemonId || {}
    const sprite = data.isShiny ? (species.sprites?.shiny || species.imageUrl) : (species.imageUrl || species.sprites?.normal)

    return (
        <div className="p-4 flex flex-col items-center min-h-[200px] bg-white transition-colors hover:bg-blue-50 text-center relative group">
            <div className="bg-blue-100/50 w-full mb-4 py-1 text-center font-bold text-blue-800 text-xs uppercase border-y border-blue-200">
                {label}
            </div>

            {/* Remove Button (X) */}
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
            <div className="text-xs font-bold text-slate-600">
                Level: {data.level}
            </div>
            <div className="text-xs text-slate-500">
                EXP: {data.experience}/{250 + Math.max(0, data.level - 1) * 100}
            </div>
            {/* HP would need actual stats calculation or stored currentHp */}
            <div className="text-xs text-slate-500">
                HP: {data.stats ? `${data.stats.hp}/${data.stats.hp}` : '?/?'}
            </div>
            <div className="text-xs text-slate-500">
                ATK: {data.stats?.atk || '?'} | DEF: {data.stats?.def || '?'}
            </div>

            {!isFirst && (
                <button
                    onClick={() => onSwap(index, 0)}
                    className="mt-4 text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline uppercase"
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
