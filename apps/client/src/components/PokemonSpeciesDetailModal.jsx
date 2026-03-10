import { useEffect, useState } from 'react'
import { gameApi } from '../services/gameApi'
import Modal from './Modal'

const TYPE_BADGE_CLASS = {
    normal: 'bg-slate-200 text-slate-700 border-slate-300',
    fire: 'bg-red-100 text-red-700 border-red-200',
    water: 'bg-blue-100 text-blue-700 border-blue-200',
    electric: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    grass: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    ice: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    fighting: 'bg-orange-100 text-orange-700 border-orange-200',
    poison: 'bg-purple-100 text-purple-700 border-purple-200',
    ground: 'bg-amber-100 text-amber-700 border-amber-200',
    flying: 'bg-sky-100 text-sky-700 border-sky-200',
    psychic: 'bg-pink-100 text-pink-700 border-pink-200',
    bug: 'bg-lime-100 text-lime-700 border-lime-200',
    rock: 'bg-stone-200 text-stone-700 border-stone-300',
    ghost: 'bg-violet-100 text-violet-700 border-violet-200',
    dragon: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    dark: 'bg-slate-300 text-slate-800 border-slate-400',
    steel: 'bg-zinc-200 text-zinc-700 border-zinc-300',
    fairy: 'bg-rose-100 text-rose-700 border-rose-200',
}

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

const resolvePokemonDisplaySprite = (speciesDetail = null, targetFormId = null) => {
    if (!speciesDetail) return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
    const forms = Array.isArray(speciesDetail?.forms) ? speciesDetail.forms : []
    const defaultFormId = normalizeFormId(speciesDetail?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(targetFormId || defaultFormId)
    let resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId) || null
    if (!resolvedForm) {
        resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || null
    }
    return resolvedForm?.imageUrl || resolvedForm?.sprites?.normal || resolvedForm?.sprites?.icon || speciesDetail?.sprites?.normal || speciesDetail?.sprites?.icon || speciesDetail?.imageUrl || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
}

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-xs uppercase tracking-wide">
        {title}
    </div>
)

const StatRow = ({ label, value, label2, value2 }) => (
    <div className="flex border-b border-blue-200 last:border-0 text-xs text-center">
        <div className="w-1/4 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center justify-center">
            {label}
        </div>
        <div className="w-1/4 p-2 font-bold text-slate-700 border-r border-blue-200 flex items-center justify-center">
            {value}
        </div>
        <div className="w-1/4 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center justify-center">
            {label2}
        </div>
        <div className="w-1/4 p-2 font-bold text-slate-700 flex items-center justify-center">
            {value2}
        </div>
    </div>
)

export default function PokemonSpeciesDetailModal({
    open,
    onClose,
    title = 'Thông tin loài Pokémon',
    speciesId = null,
    formId = null,
}) {
    const [speciesDetail, setSpeciesDetail] = useState(null)
    const [loadingDetail, setLoadingDetail] = useState(false)
    const [loadingError, setLoadingError] = useState('')

    useEffect(() => {
        if (!open) return

        if (!speciesId) {
            setSpeciesDetail(null)
            setLoadingError('Không tìm thấy ID Pokémon để tải chi tiết.')
            setLoadingDetail(false)
            return
        }

        let cancelled = false
        const loadSpeciesDetail = async () => {
            try {
                setLoadingDetail(true)
                setLoadingError('')
                const detail = await gameApi.getPokemonSpeciesDetail(speciesId)
                if (!cancelled) {
                    setSpeciesDetail(detail || null)
                }
            } catch (error) {
                if (!cancelled) {
                    setSpeciesDetail(null)
                    setLoadingError(error?.message || 'Không thể tải chi tiết Pokémon')
                }
            } finally {
                if (!cancelled) {
                    setLoadingDetail(false)
                }
            }
        }

        loadSpeciesDetail()

        return () => {
            cancelled = true
        }
    }, [open, speciesId])

    const displayName = String(speciesDetail?.name || '--').trim()
    const resolvedSprite = resolvePokemonDisplaySprite(speciesDetail, formId)
    const forms = Array.isArray(speciesDetail?.forms) ? speciesDetail.forms : []
    const defaultFormId = normalizeFormId(speciesDetail?.defaultFormId || 'normal')
    const requestedFormId = normalizeFormId(formId || defaultFormId)

    let resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId) || null
    if (!resolvedForm) {
        resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === defaultFormId) || null
    }

    const resolvedFormId = String(resolvedForm?.formId || requestedFormId).trim()
    const formName = String(resolvedForm?.formName || resolvedForm?.formId || resolvedFormId).trim()

    // We get types from resolvedForm if defined, else speciesDetail
    const rawTypes = Array.isArray(resolvedForm?.types) && resolvedForm.types.length > 0
        ? resolvedForm.types
        : (Array.isArray(speciesDetail?.types) ? speciesDetail.types : [])

    const types = rawTypes.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)

    // Display baseStats from resolvedForm if defined, else speciesDetail
    const baseStats = (resolvedForm?.baseStats && Object.keys(resolvedForm.baseStats).length > 0)
        ? resolvedForm.baseStats
        : (speciesDetail?.baseStats || {})

    return (
        <Modal
            isOpen={Boolean(open)}
            onClose={onClose}
            title={title}
            maxWidth="sm"
        >
            {loadingDetail ? (
                <div className="py-10 text-center text-slate-500 font-bold">Đang tải thông tin loài...</div>
            ) : loadingError ? (
                <div className="space-y-3 p-4">
                    <div className="text-red-700 font-bold text-center">{loadingError}</div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="border border-blue-400 rounded-lg overflow-hidden shadow-sm bg-white">
                        <SectionHeader title={displayName} />
                        <div className="p-4 bg-slate-50">
                            <div className="flex flex-col items-center">
                                <div className="relative w-28 h-28 flex items-center justify-center mb-2">
                                    <img
                                        src={resolvedSprite}
                                        alt={displayName}
                                        className="max-w-full max-h-full pixelated rendering-pixelated scale-125"
                                        onError={(event) => {
                                            event.currentTarget.onerror = null
                                            event.currentTarget.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                        }}
                                    />
                                </div>
                                <div className="text-xl font-bold text-slate-800 text-center flex flex-col items-center gap-1">
                                    {displayName}
                                    {resolvedFormId !== 'normal' && (
                                        <div className="text-[10px] text-sky-700 bg-sky-100 px-2 py-0.5 rounded border border-sky-200">
                                            {formName}
                                        </div>
                                    )}
                                </div>
                                {types.length > 0 && (
                                    <div className="flex gap-2 justify-center mt-3">
                                        {types.map((t, i) => (
                                            <span
                                                key={i}
                                                className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase shadow-sm ${TYPE_BADGE_CLASS[t] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
                                            >
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="border border-blue-400 rounded-lg overflow-hidden shadow-sm bg-white">
                        <SectionHeader title="Chỉ số cơ bản" />
                        <div className="flex flex-col">
                            <StatRow
                                label="HP" value={baseStats.hp || 0}
                                label2="Attack" value2={baseStats.atk || 0}
                            />
                            <StatRow
                                label="Defense" value={baseStats.def || 0}
                                label2="Sp. Atk" value2={baseStats.spatk || 0}
                            />
                            <StatRow
                                label="Sp. Def" value={baseStats.spdef || baseStats.spldef || 0}
                                label2="Speed" value2={baseStats.spd || 0}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end pt-2 pb-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border border-slate-300 rounded font-bold text-slate-700 hover:bg-slate-50 transition-colors shadow-sm text-sm"
                        >
                            Đóng
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    )
}
