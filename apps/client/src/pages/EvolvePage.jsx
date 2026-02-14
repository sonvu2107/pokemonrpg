import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

export default function EvolvePage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { showSuccess, showError } = useToast()
    const { user, loading: authLoading } = useAuth()

    const [loading, setLoading] = useState(true)
    const [evolving, setEvolving] = useState(false)
    const [pokemon, setPokemon] = useState(null)
    const [evolved, setEvolved] = useState(false)
    const [evolutionMessage, setEvolutionMessage] = useState('')

    const loadPokemon = async () => {
        if (!id) {
            setPokemon(null)
            setLoading(false)
            return
        }

        try {
            setLoading(true)
            const data = await gameApi.getPokemonDetail(id)
            setPokemon(data)
        } catch (error) {
            showError(error.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!authLoading && user?.role === 'admin') {
            setEvolved(false)
            setEvolutionMessage('')
            loadPokemon()
        } else {
            setLoading(false)
        }
    }, [id, authLoading, user])

    const handleEvolve = async () => {
        if (!id) return

        setEvolving(true)
        try {
            const res = await gameApi.evolvePokemon(id)
            setEvolutionMessage(res.message || '')
            await loadPokemon()
            setEvolved(true)

            if (res?.evolution?.from && res?.evolution?.to) {
                showSuccess(`${res.evolution.from} đã tiến hóa thành ${res.evolution.to}!`)
            } else {
                showSuccess(res.message || 'Tiến hóa thành công!')
            }
        } catch (error) {
            showError(error.message)
        } finally {
            setEvolving(false)
        }
    }

    if (authLoading) return <div className="p-10 text-center">Đang tải...</div>

    // Access Control: Only admins allowed
    if (!user || user.role !== 'admin') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center space-y-6 animate-fade-in">
                <div className="w-32 h-32 bg-blue-50 rounded-full flex items-center justify-center mb-4 relative overflow-hidden">
                    <div className="absolute inset-0 bg-blue-100 opacity-50 animate-pulse"></div>
                    <span className="text-5xl relative z-10">🚧</span>
                </div>
                <h1 className="text-3xl font-black text-slate-800 uppercase">
                    Tính năng đang cập nhật
                </h1>
                <p className="text-slate-600 max-w-lg text-lg">
                    Hệ thống tiến hóa đang được bảo trì và nâng cấp để mang lại trải nghiệm tốt nhất. Vui lòng quay lại sau!
                </p>
                <button
                    onClick={() => navigate('/')}
                    className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg shadow-lg transition-all transform hover:scale-105"
                >
                    Về Trang Chủ
                </button>
            </div>
        )
    }

    if (loading) {
        return <div className="p-10 text-center">Đang tải dữ liệu...</div>
    }

    if (!id) {
        return (
            <div className="max-w-3xl mx-auto p-6">
                <div className="bg-white border border-slate-200 rounded-lg p-6 text-center space-y-4 shadow-sm">
                    <h1 className="text-2xl font-bold text-slate-800">Admin: Test Tiến Hóa</h1>
                    <p className="text-slate-600">Chọn một Pokémon trong kho để test.</p>
                    <button
                        onClick={() => navigate('/box')}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded"
                    >
                        Đi đến Kho Pokémon
                    </button>
                </div>
            </div>
        )
    }

    if (!pokemon) {
        return <div className="p-10 text-center">Không tìm thấy Pokémon</div>
    }

    const currentName = pokemon.nickname || pokemon.pokemonId?.name || 'Pokemon'
    const currentSprite = pokemon.pokemonId?.sprites?.normal || pokemon.pokemonId?.imageUrl || ''
    const targetPokemon = pokemon.evolution?.targetPokemon || null
    const targetName = targetPokemon?.name || 'Chưa có'
    const targetSprite = targetPokemon?.sprites?.normal || ''
    const evolutionLevel = pokemon.evolution?.evolutionLevel || null
    const canEvolve = Boolean(pokemon.evolution?.canEvolve)

    return (
        <div className="max-w-4xl mx-auto p-4 animate-fade-in">
            {/* Admin Warning Banner */}
            <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4" role="alert">
                <p className="font-bold">Chế độ Admin</p>
                <p>Bạn đang truy cập trang này với quyền Admin. Người dùng thường sẽ thấy thông báo bảo trì.</p>
            </div>

            <div className="bg-white rounded-xl shadow-lg border border-blue-200 overflow-hidden relative">
                <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-1">
                    <div className="bg-white/10 p-2 text-center text-white text-xs font-bold tracking-wider uppercase">
                        Khu vực tiến hóa
                    </div>
                </div>

                <div className="p-8 text-center space-y-8">
                    <h1 className="text-4xl font-black text-blue-900 drop-shadow-sm uppercase tracking-tight">
                        Tiến Hóa Pokémon
                    </h1>

                    <div className="flex items-center justify-center gap-8 md:gap-16 py-8">
                        <div className="flex flex-col items-center gap-3 group">
                            <div className="relative">
                                <div className="w-24 h-24 md:w-32 md:h-32 bg-slate-100 rounded-full flex items-center justify-center shadow-inner border-4 border-white ring-2 ring-slate-100 group-hover:ring-blue-300 transition-all">
                                    <img
                                        src={currentSprite}
                                        alt={currentName}
                                        className="w-20 h-20 md:w-24 md:h-24 pixelated object-contain transform group-hover:scale-110 transition-transform duration-300"
                                    />
                                </div>
                                {evolved && (
                                    <div className="absolute inset-0 bg-white/50 rounded-full flex items-center justify-center backdrop-blur-[1px]">
                                        <span className="text-3xl">✨</span>
                                    </div>
                                )}
                            </div>
                            <span className="font-bold text-slate-600">{currentName}</span>
                        </div>

                        <div className="flex flex-col items-center gap-1 text-blue-300">
                            <div className="flex gap-1 animate-pulse">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 5l7 7-7 7" />
                                </svg>
                            </div>
                        </div>

                        <div className="flex flex-col items-center gap-3">
                            <div className={`w-24 h-24 md:w-32 md:h-32 bg-yellow-50 rounded-full flex items-center justify-center shadow-inner border-4 border-white ring-2 ring-yellow-100 ${evolved ? 'ring-yellow-400 scale-110' : ''} transition-all duration-500`}>
                                {targetSprite ? (
                                    <img
                                        src={targetSprite}
                                        alt={targetName}
                                        className={`w-20 h-20 md:w-24 md:h-24 pixelated object-contain ${evolved ? 'animate-bounce' : 'opacity-40 grayscale'} transition-all duration-500`}
                                    />
                                ) : (
                                    <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-slate-200 border border-slate-300" />
                                )}
                            </div>
                            <span className="font-bold text-slate-800">{targetName}</span>
                        </div>
                    </div>

                    {!evolved && canEvolve ? (
                        <div className="space-y-6">
                            <p className="text-green-700 font-medium text-lg bg-green-50 inline-block px-6 py-2 rounded-full border border-green-100">
                                <span className="font-bold">{currentName}</span> có thể tiến hóa thành <span className="font-bold">{targetName}</span>{evolutionLevel ? <> (mốc cấp <span className="font-bold">{evolutionLevel}</span>)</> : ''}.
                            </p>

                            <div>
                                <button
                                    onClick={handleEvolve}
                                    disabled={evolving}
                                    className={`px-10 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-wider rounded-lg shadow-lg hover:shadow-xl transform active:scale-95 transition-all text-lg ${evolving ? 'opacity-75 cursor-wait' : ''}`}
                                >
                                    {evolving ? 'Đang tiến hóa...' : 'Tiến hóa'}
                                </button>
                            </div>
                        </div>
                    ) : !evolved ? (
                        <div className="space-y-3">
                            <p className="text-slate-700 font-medium text-lg bg-slate-50 inline-block px-6 py-2 rounded-full border border-slate-200">
                                {targetPokemon
                                    ? `${currentName} chưa đủ điều kiện tiến hóa${evolutionLevel ? ` (cần cấp ${evolutionLevel})` : ''}.`
                                    : `${currentName} chưa có thiết lập tiến hóa theo cấp.`}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-fade-in-up">
                            <p className="text-blue-700 font-bold text-xl">
                                {evolutionMessage || `${currentName} đã tiến hóa thành công!`}
                            </p>
                            <button
                                onClick={() => navigate('/box')}
                                className="px-6 py-2 border-2 border-slate-300 hover:border-slate-400 text-slate-600 font-bold rounded-lg transition-colors"
                            >
                                Quay lại Kho
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
