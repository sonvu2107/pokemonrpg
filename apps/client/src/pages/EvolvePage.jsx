import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'

export default function EvolvePage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { showSuccess, showError } = useToast()

    const [loading, setLoading] = useState(true)
    const [evolving, setEvolving] = useState(false)
    const [pokemon, setPokemon] = useState(null)
    const [evolved, setEvolved] = useState(false)
    const [evolutionMessage, setEvolutionMessage] = useState('')
    const [noEligiblePokemon, setNoEligiblePokemon] = useState(false)

    const resolveEvolutionRule = (species = {}, currentFormId = 'normal') => {
        const normalizedFormId = String(currentFormId || '').trim()
        const forms = Array.isArray(species?.forms) ? species.forms : []
        const matchedForm = forms.find((entry) => String(entry?.formId || '').trim() === normalizedFormId) || null
        const evolution = matchedForm?.evolution?.evolvesTo ? matchedForm.evolution : (species?.evolution || {})
        const rawEvolvesTo = evolution?.evolvesTo
        const evolvesTo = rawEvolvesTo
            ? (typeof rawEvolvesTo === 'string' ? rawEvolvesTo : String(rawEvolvesTo?._id || rawEvolvesTo).trim())
            : ''
        const minLevel = Number.parseInt(evolution?.minLevel, 10)

        return {
            evolvesTo,
            minLevel: Number.isFinite(minLevel) && minLevel > 0 ? minLevel : null,
        }
    }

    const canEvolveFromBoxEntry = (entry) => {
        const species = entry?.pokemonId || {}
        const { evolvesTo, minLevel } = resolveEvolutionRule(species, entry?.formId)
        if (!evolvesTo || minLevel === null) return false
        return Number(entry?.level || 0) >= minLevel
    }

    const redirectToFirstEligiblePokemon = async () => {
        const data = await api.getBox({ page: 1, limit: 500, sort: 'level', filter: 'all' })
        const list = Array.isArray(data?.pokemon) ? data.pokemon : []
        const candidate = list.find(canEvolveFromBoxEntry)

        if (candidate?._id) {
            navigate(`/pokemon/${candidate._id}/evolve`, { replace: true })
            return true
        }

        return false
    }

    const loadPokemon = async () => {
        if (!id) {
            try {
                setLoading(true)
                setNoEligiblePokemon(false)
                const redirected = await redirectToFirstEligiblePokemon()
                if (!redirected) {
                    setPokemon(null)
                    setNoEligiblePokemon(true)
                }
            } catch (error) {
                setPokemon(null)
                setNoEligiblePokemon(true)
                showError(error.message || 'Không thể tải danh sách Pokémon')
            } finally {
                setLoading(false)
            }
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
        setEvolved(false)
        setEvolutionMessage('')
        loadPokemon()
    }, [id])

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

    if (loading) {
        return <div className="p-10 text-center">Đang tải...</div>
    }

    if (!id) {
        return (
            <div className="max-w-3xl mx-auto p-6">
                <div className="bg-white border border-slate-200 rounded-lg p-6 text-center space-y-4">
                    <h1 className="text-2xl font-bold text-slate-800">Tiến Hóa Pokémon</h1>
                    <p className="text-slate-600">
                        {noEligiblePokemon
                            ? 'Bạn chưa có Pokémon nào đủ điều kiện tiến hóa ngay lúc này.'
                            : 'Đang tìm Pokémon đủ điều kiện tiến hóa...'}
                    </p>
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

                    {/* Evolution Stage - Always visible but styled differently when evolved */}
                    <div className="flex items-center justify-center gap-8 md:gap-16 py-8">
                        {/* Current Form */}
                        <div className="flex flex-col items-center gap-3 group">
                            <div className="relative">
                                <div className="w-24 h-24 md:w-32 md:h-32 bg-slate-100 rounded-full flex items-center justify-center shadow-inner border-4 border-white ring-2 ring-slate-100">
                                    <img
                                        src={currentSprite}
                                        alt={currentName}
                                        className="w-20 h-20 md:w-24 md:h-24 pixelated object-contain"
                                    />
                                </div>
                            </div>
                            {/* Hide name in success state if we strictly follow screenshot, but keeping it is usually better. 
                                The screenshot has text BELOW the sprites saying 'Bulbasaur has evolved into Ivysaur'. 
                                I'll keep names hidden or small? The screenshot shows icons only, then text below.
                            */}
                            {!evolved && <span className="font-bold text-slate-600">{currentName}</span>}
                        </div>

                        {/* Arrow - Hide when evolved if strictly matching simple view, or keep for flow */}
                        {!evolved && (
                            <div className="flex flex-col items-center gap-1 text-blue-300">
                                <div className="flex gap-1 animate-pulse">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </div>
                        )}

                        {/* Target Form */}
                        <div className="flex flex-col items-center gap-3">
                            <div className={`w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center border-4 border-white ring-2 shadow-inner transition-all duration-500 ${evolved ? 'bg-yellow-50 ring-yellow-400 scale-110' : 'bg-slate-100 ring-slate-100'}`}>
                                {targetSprite ? (
                                    <img
                                        src={targetSprite}
                                        alt={targetName}
                                        className={`w-20 h-20 md:w-24 md:h-24 pixelated object-contain transition-all duration-500 ${evolved ? 'animate-bounce' : 'opacity-40 grayscale'}`}
                                    />
                                ) : (
                                    <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-slate-200 border border-slate-300" />
                                )}
                            </div>
                            {!evolved && <span className="font-bold text-slate-800">{targetName}</span>}
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
                            <p className="text-slate-800 font-medium text-xl">
                                <span className="font-bold">{currentName}</span> đã tiến hóa thành <span className="font-bold text-blue-600">{targetName}</span>!
                            </p>

                            {/* Optional: Add confetti or effect here? user just asked for UI match */}

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
