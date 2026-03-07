import { useEffect, useMemo, useState } from 'react'
import { gameApi } from '../services/gameApi'
import Modal from './Modal'
import VipAvatar from './VipAvatar'
import VipTitleBadge from './VipTitleBadge'
import { getPublicRoleLabel } from '../utils/vip'

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
const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const formatTypeLabel = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return '--'
    return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

const formatDateTime = (value) => {
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

const toOptionalNumber = (value) => {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

const buildStatusLabel = (status) => {
    const normalized = String(status || '').trim().toLowerCase()
    if (normalized === 'active') return 'Đang bán'
    if (normalized === 'sold') return 'Đã bán'
    if (normalized === 'cancelled') return 'Đã hủy'
    return normalized || '--'
}

const resolvePokemonTradeId = (pokemon = null) => {
    const direct = String(pokemon?.userPokemonId || '').trim()
    if (direct) return direct
    const fallback = String(pokemon?.id || '').trim()
    return fallback
}

const resolvePokemonDisplaySprite = (pokemonDetail = null) => {
    const species = pokemonDetail?.pokemonId || {}
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const resolvedFormId = normalizeFormId(pokemonDetail?.formId || species?.defaultFormId || 'normal')
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === resolvedFormId) || null

    const baseNormal = species?.imageUrl || species?.sprites?.normal || species?.sprites?.icon || ''
    const formNormal = resolvedForm?.imageUrl || resolvedForm?.sprites?.normal || resolvedForm?.sprites?.icon || baseNormal
    const formShiny = resolvedForm?.sprites?.shiny || species?.sprites?.shiny || formNormal
    return pokemonDetail?.isShiny ? formShiny : formNormal
}

const resolveMoveDetails = (pokemonDetail = null) => {
    const rawMoveDetails = Array.isArray(pokemonDetail?.moveDetails) ? pokemonDetail.moveDetails : []
    if (rawMoveDetails.length > 0) {
        return rawMoveDetails
            .map((entry) => {
                const moveName = String(entry?.name || '').trim()
                if (!moveName) return null
                return {
                    name: moveName,
                    type: String(entry?.type || '').trim().toLowerCase(),
                    category: String(entry?.category || '').trim().toLowerCase(),
                    power: toOptionalNumber(entry?.power),
                    accuracy: toOptionalNumber(entry?.accuracy),
                    currentPp: Math.max(0, Number(entry?.currentPp || 0)),
                    maxPp: Math.max(1, Number(entry?.maxPp || 1)),
                }
            })
            .filter(Boolean)
    }

    return (Array.isArray(pokemonDetail?.moves) ? pokemonDetail.moves : [])
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .map((entry) => ({
            name: entry,
            type: '',
            category: '',
            power: null,
            accuracy: null,
            currentPp: 0,
            maxPp: 1,
        }))
}

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-xs uppercase tracking-wide">
        {title}
    </div>
)

const StatRow = ({ label, value, label2, value2 }) => (
    <div className="flex border-b border-blue-200 last:border-0 text-xs">
        <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
            {label}:
        </div>
        <div className="w-1/3 p-2 font-bold text-slate-700 border-r border-blue-200 flex items-center justify-center">
            {value}
        </div>
        <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
            {label2}:
        </div>
        <div className="w-1/3 p-2 font-bold text-slate-700 flex items-center justify-center">
            {value2}
        </div>
    </div>
)

export default function PokemonTradeDetailModal({
    open,
    onClose,
    title = 'Chi tiết Pokémon',
    pokemon = null,
}) {
    const [pokemonDetail, setPokemonDetail] = useState(null)
    const [loadingDetail, setLoadingDetail] = useState(false)
    const [loadingError, setLoadingError] = useState('')

    const tradePokemonId = useMemo(() => resolvePokemonTradeId(pokemon), [pokemon])

    useEffect(() => {
        if (!open) return

        if (!tradePokemonId) {
            setPokemonDetail(null)
            setLoadingError('Không tìm thấy ID Pokémon để tải chi tiết.')
            setLoadingDetail(false)
            return
        }

        let cancelled = false
        const loadPokemonDetail = async () => {
            try {
                setLoadingDetail(true)
                setLoadingError('')
                const detail = await gameApi.getPokemonDetail(tradePokemonId)
                if (!cancelled) {
                    setPokemonDetail(detail || null)
                }
            } catch (error) {
                if (!cancelled) {
                    setPokemonDetail(null)
                    setLoadingError(error?.message || 'Không thể tải chi tiết Pokémon')
                }
            } finally {
                if (!cancelled) {
                    setLoadingDetail(false)
                }
            }
        }

        loadPokemonDetail()

        return () => {
            cancelled = true
        }
    }, [open, tradePokemonId])

    const species = pokemonDetail?.pokemonId || {}
    const displayName = String(pokemonDetail?.nickname || species?.name || pokemon?.pokemonName || pokemon?.speciesName || 'Pokemon').trim()
    const speciesName = String(species?.name || pokemon?.speciesName || '--').trim()
    const ownerInfo = pokemonDetail?.userId && typeof pokemonDetail.userId === 'object' ? pokemonDetail.userId : null
    const ownerName = String(ownerInfo?.username || pokemon?.seller?.username || '--').trim() || '--'
    const ownerAvatar = String(ownerInfo?.avatar || '').trim() || DEFAULT_AVATAR
    const resolvedSprite = resolvePokemonDisplaySprite(pokemonDetail) || pokemon?.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
    const level = Math.max(1, Number(pokemonDetail?.level || pokemon?.level || 1))
    const combatPower = Math.max(1, Number(pokemonDetail?.combatPower ?? pokemonDetail?.power ?? (level * 10)) || 1)
    const formId = normalizeFormId(pokemonDetail?.formId || pokemon?.formId || species?.defaultFormId || 'normal')
    const formName = String(pokemonDetail?.formName || pokemon?.formName || formId).trim()
    const types = Array.isArray(species?.types)
        ? species.types.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
        : (Array.isArray(pokemon?.type)
            ? pokemon.type.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
            : [])
    const stats = pokemonDetail?.stats || {}
    const moves = resolveMoveDetails(pokemonDetail)
    const moveDisplaySlots = Array.from({ length: 4 }, (_, index) => moves[index] || null)

    return (
        <Modal
            isOpen={Boolean(open)}
            onClose={onClose}
            title={title}
            maxWidth="md"
        >
            {loadingDetail ? (
                <div className="py-10 text-center text-slate-500 font-bold">Đang tải chi tiết Pokémon...</div>
            ) : loadingError ? (
                <div className="space-y-3">
                    <div className="text-red-700 font-bold text-center">{loadingError}</div>
                    {pokemon && (
                        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                            <div><span className="font-bold">Pokémon:</span> {pokemon.pokemonName || pokemon.speciesName || '--'}</div>
                            <div><span className="font-bold">Level:</span> Lv.{Math.max(1, Number(pokemon.level) || 1)}</div>
                            <div><span className="font-bold">Giá:</span> {Number(pokemon.price || 0).toLocaleString('vi-VN')} xu</div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                        <SectionHeader title={`${speciesName} • Lv.${level}`} />
                        <div className="p-4">
                            <div className="flex flex-col items-center mb-4">
                                <div className="relative w-28 h-28 flex items-center justify-center mb-2">
                                    <img
                                        src={resolvedSprite}
                                        alt={speciesName}
                                        className="max-w-full max-h-full pixelated rendering-pixelated scale-125"
                                        onError={(event) => {
                                            event.currentTarget.onerror = null
                                            event.currentTarget.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                        }}
                                    />
                                </div>
                                <h3 className="text-xl font-bold text-blue-900 flex items-center gap-2">
                                    {displayName}
                                    {pokemonDetail?.isShiny && <span className="text-amber-500 text-sm">★</span>}
                                </h3>
                                {formId !== 'normal' && (
                                    <div className="mt-1">
                                        <span className="text-[11px] uppercase bg-sky-100 text-sky-700 px-2 py-0.5 rounded border border-sky-200">
                                            {formName}
                                        </span>
                                    </div>
                                )}
                                <div className="text-xs font-bold mt-2 flex gap-2">
                                    <span className="bg-slate-200 px-2 py-0.5 rounded text-slate-700">Lv. {level}</span>
                                    <span className="bg-rose-100 px-2 py-0.5 rounded text-rose-700">LC {combatPower.toLocaleString('vi-VN')}</span>
                                </div>
                                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                                    {types.length > 0 ? types.map((type) => (
                                        <span
                                            key={`type-${type}`}
                                            className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${TYPE_BADGE_CLASS[type] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
                                        >
                                            {formatTypeLabel(type)}
                                        </span>
                                    )) : (
                                        <span className="text-[10px] text-slate-400">Chưa có dữ liệu hệ</span>
                                    )}
                                </div>
                            </div>

                            <div className="border border-blue-300 rounded overflow-hidden mb-4">
                                <div className="bg-blue-100/50 p-1 text-center text-xs font-bold text-blue-800 border-b border-blue-200">
                                    Chỉ Số Pokémon
                                </div>
                                <StatRow label="Max HP" value={Math.max(1, Number(stats.maxHp || stats.hp || 1))} label2="Attack" value2={Math.max(1, Number(stats.atk || 1))} />
                                <StatRow label="Defense" value={Math.max(1, Number(stats.def || 1))} label2="Sp. Atk" value2={Math.max(1, Number(stats.spatk || 1))} />
                                <StatRow label="Sp. Def" value={Math.max(1, Number(stats.spdef || stats.spldef || 1))} label2="Speed" value2={Math.max(1, Number(stats.spd || 1))} />
                            </div>

                            <div className="border border-blue-300 rounded overflow-hidden mb-4">
                                <div className="bg-blue-100/50 p-1 text-center text-xs font-bold text-blue-800 border-b border-blue-200">
                                    Kỹ Năng
                                </div>
                                <div className="flex border-b border-blue-200 last:border-0 text-xs text-center">
                                    {moveDisplaySlots.map((slot, index) => {
                                        const isLast = index === moveDisplaySlots.length - 1
                                        return (
                                            <div
                                                key={`move-slot-${index}`}
                                                className={`w-1/4 p-2 font-bold text-slate-700 ${isLast ? '' : 'border-r border-blue-200'}`}
                                            >
                                                {slot ? (
                                                    <>
                                                        <div>{slot.name}</div>
                                                        <div className="text-[10px] text-slate-500 mt-0.5">{slot.currentPp}/{slot.maxPp} PP</div>
                                                        <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                                                            {slot.type ? String(slot.type).toUpperCase() : '--'}
                                                            {' • '}
                                                            {slot.category ? String(slot.category).toUpperCase() : '--'}
                                                            {' • Pow '}
                                                            {toOptionalNumber(slot.power) ?? '--'}
                                                            {' • Acc '}
                                                            {toOptionalNumber(slot.accuracy) ?? '--'}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="italic text-slate-400">-</div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="border border-blue-300 rounded overflow-hidden">
                                <div className="bg-blue-100/50 p-1 text-center text-xs font-bold text-blue-800 border-b border-blue-200">
                                    Thông Tin Giao Dịch
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2 text-xs">
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 sm:col-span-2">
                                        <div className="font-bold text-slate-600 uppercase mb-2">Chủ sở hữu hiện tại:</div>
                                        <div className="flex items-center gap-3 min-w-0">
                                            <VipAvatar
                                                userLike={ownerInfo}
                                                avatar={ownerAvatar}
                                                fallback={DEFAULT_AVATAR}
                                                alt={ownerName}
                                                wrapperClassName="h-12 w-12"
                                                imageClassName="h-12 w-12 rounded-full object-cover pixelated"
                                                frameClassName="h-12 w-12 rounded-full object-cover"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                                    <span className="font-bold text-sm text-slate-800 truncate">{ownerName}</span>
                                                    <VipTitleBadge userLike={ownerInfo} />
                                                </div>
                                                <div className="text-[11px] font-semibold text-slate-500 mt-0.5">
                                                    Nhóm: {getPublicRoleLabel(ownerInfo)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                                        <span className="font-bold text-slate-600 uppercase">Giá:</span>{' '}
                                        <span className="font-bold text-slate-800">{Number(pokemon?.price || 0).toLocaleString('vi-VN')} xu</span>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                                        <span className="font-bold text-slate-600 uppercase">Trạng thái:</span>{' '}
                                        <span className="font-bold text-slate-800">{buildStatusLabel(pokemon?.status)}</span>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                                        <span className="font-bold text-slate-600 uppercase">Người bán:</span>{' '}
                                        <span className="font-bold text-slate-800 break-all">{pokemon?.seller?.username || '--'}</span>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                                        <span className="font-bold text-slate-600 uppercase">Người mua:</span>{' '}
                                        <span className="font-bold text-slate-800 break-all">{pokemon?.buyer?.username || '--'}</span>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 sm:col-span-2">
                                        <span className="font-bold text-slate-600 uppercase">OT:</span>{' '}
                                        <span className="font-bold text-slate-800 break-all">{pokemon?.otName || '--'}</span>
                                    </div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 sm:col-span-2">
                                        <div>
                                            <span className="font-bold text-slate-600 uppercase">Đăng bán:</span>{' '}
                                            <span className="font-bold text-slate-800">{formatDateTime(pokemon?.listedAt)}</span>
                                        </div>
                                        <div>
                                            <span className="font-bold text-slate-600 uppercase">Đã bán:</span>{' '}
                                            <span className="font-bold text-slate-800">{formatDateTime(pokemon?.soldAt)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </Modal>
    )
}
