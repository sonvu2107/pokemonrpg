import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import FeatureUnavailableNotice from '../components/FeatureUnavailableNotice'
import { useAuth } from '../context/AuthContext'

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
    const { user } = useAuth()
    const [pokemon, setPokemon] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [featureNotice, setFeatureNotice] = useState('')
    const [skillModalOpen, setSkillModalOpen] = useState(false)
    const [skillInventory, setSkillInventory] = useState([])
    const [skillLoading, setSkillLoading] = useState(false)
    const [skillError, setSkillError] = useState('')
    const [selectedSkillId, setSelectedSkillId] = useState('')
    const [replaceMoveIndex, setReplaceMoveIndex] = useState(-1)
    const [teachingSkill, setTeachingSkill] = useState(false)

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

    const loadSkillInventory = async () => {
        try {
            setSkillLoading(true)
            setSkillError('')
            const data = await gameApi.getPokemonSkills(id)
            const skills = Array.isArray(data?.skills) ? data.skills : []
            setSkillInventory(skills)
            if (skills.length > 0) {
                const firstLearnable = skills.find((entry) => entry.canLearn)
                setSelectedSkillId(firstLearnable ? String(firstLearnable.moveId) : String(skills[0].moveId))
            } else {
                setSelectedSkillId('')
            }
        } catch (err) {
            setSkillError(err.message || 'Không thể tải kho kỹ năng')
            setSkillInventory([])
            setSelectedSkillId('')
        } finally {
            setSkillLoading(false)
        }
    }

    const openSkillModal = async () => {
        setSkillModalOpen(true)
        setReplaceMoveIndex(-1)
        await loadSkillInventory()
    }

    const handleTeachSkill = async () => {
        const selectedSkill = skillInventory.find((entry) => String(entry.moveId) === String(selectedSkillId))
        if (!selectedSkill) {
            setFeatureNotice('Vui lòng chọn một kỹ năng để học.')
            return
        }
        if (!selectedSkill.canLearn) {
            setFeatureNotice(selectedSkill.reason || 'Pokemon này đã biết kỹ năng đã chọn.')
            return
        }

        const currentMoves = Array.isArray(pokemon?.moves)
            ? pokemon.moves.map((entry) => String(entry || '').trim()).filter(Boolean)
            : []

        const payload = {
            moveId: selectedSkill.moveId,
        }

        if (currentMoves.length >= 4) {
            if (replaceMoveIndex < 0 || replaceMoveIndex >= currentMoves.length) {
                setFeatureNotice('Pokemon đã đủ 4 kỹ năng. Hãy chọn kỹ năng cần thay thế.')
                return
            }
            payload.replaceMoveIndex = replaceMoveIndex
        }

        try {
            setTeachingSkill(true)
            const data = await gameApi.teachPokemonSkill(id, payload)
            setPokemon((prev) => {
                if (!prev) return prev
                return {
                    ...prev,
                    moves: Array.isArray(data?.pokemon?.moves) ? data.pokemon.moves : prev.moves,
                    movePpState: Array.isArray(data?.pokemon?.movePpState) ? data.pokemon.movePpState : prev.movePpState,
                }
            })
            setFeatureNotice(data?.message || 'Pokemon đã học kỹ năng mới.')
            setReplaceMoveIndex(-1)
            await loadSkillInventory()
        } catch (err) {
            setFeatureNotice(err.message || 'Dạy kỹ năng thất bại.')
        } finally {
            setTeachingSkill(false)
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
    const currentMoves = Array.isArray(pokemon.moves)
        ? pokemon.moves.map((entry) => String(entry || '').trim()).filter(Boolean)
        : []
    const movePpMap = new Map(
        (Array.isArray(pokemon.movePpState) ? pokemon.movePpState : [])
            .map((entry) => [
                String(entry?.moveName || '').trim().toLowerCase(),
                {
                    currentPp: Math.max(0, Number(entry?.currentPp || 0)),
                    maxPp: Math.max(1, Number(entry?.maxPp || 1)),
                },
            ])
    )
    const viewerId = String(user?.id || user?._id || '').trim()
    const ownerId = String(pokemon?.userId?._id || '').trim()
    const isOwnerViewing = Boolean(viewerId && ownerId && viewerId === ownerId)
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
                            {currentMoves.length > 0 ? (
                                <>
                                    <div className="w-1/4 p-2 border-r border-blue-200 font-bold text-slate-700">
                                        {currentMoves[0] || '-'}
                                        {currentMoves[0] && (
                                            <div className="text-[10px] text-slate-500 mt-0.5">
                                                {(() => {
                                                    const state = movePpMap.get(String(currentMoves[0] || '').toLowerCase())
                                                    return state ? `${state.currentPp}/${state.maxPp} PP` : '--/-- PP'
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                    <div className="w-1/4 p-2 border-r border-blue-200 font-bold text-slate-700">
                                        {currentMoves[1] || '-'}
                                        {currentMoves[1] && (
                                            <div className="text-[10px] text-slate-500 mt-0.5">
                                                {(() => {
                                                    const state = movePpMap.get(String(currentMoves[1] || '').toLowerCase())
                                                    return state ? `${state.currentPp}/${state.maxPp} PP` : '--/-- PP'
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                    <div className="w-1/4 p-2 border-r border-blue-200 font-bold text-slate-700">
                                        {currentMoves[2] || '-'}
                                        {currentMoves[2] && (
                                            <div className="text-[10px] text-slate-500 mt-0.5">
                                                {(() => {
                                                    const state = movePpMap.get(String(currentMoves[2] || '').toLowerCase())
                                                    return state ? `${state.currentPp}/${state.maxPp} PP` : '--/-- PP'
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                    <div className="w-1/4 p-2 font-bold text-slate-700">
                                        {currentMoves[3] || '-'}
                                        {currentMoves[3] && (
                                            <div className="text-[10px] text-slate-500 mt-0.5">
                                                {(() => {
                                                    const state = movePpMap.get(String(currentMoves[3] || '').toLowerCase())
                                                    return state ? `${state.currentPp}/${state.maxPp} PP` : '--/-- PP'
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="w-full p-2 italic text-slate-400">Chưa học kỹ năng nào</div>
                            )}
                        </div>

                        {isOwnerViewing && (
                            <div className="p-2 bg-slate-50 border-t border-blue-200 text-center">
                                <button
                                    type="button"
                                    onClick={openSkillModal}
                                    className="px-3 py-1.5 text-xs font-bold rounded bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                                >
                                    Học Kỹ Năng Từ Kho
                                </button>
                            </div>
                        )}
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

            {skillModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/70 p-4 flex items-center justify-center">
                    <div className="w-full max-w-2xl bg-white border border-blue-300 rounded-lg shadow-xl overflow-hidden">
                        <div className="bg-gradient-to-t from-blue-600 to-cyan-500 px-4 py-2 flex items-center justify-between border-b border-blue-600">
                            <h3 className="text-sm sm:text-base font-bold text-white uppercase">Dạy Kỹ Năng Cho Pokemon</h3>
                            <button
                                type="button"
                                onClick={() => setSkillModalOpen(false)}
                                className="text-white text-xs font-bold px-2 py-1 rounded hover:bg-white/20"
                            >
                                Đóng
                            </button>
                        </div>

                        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
                            {skillLoading ? (
                                <div className="text-center text-slate-500 py-8">Đang tải kho kỹ năng...</div>
                            ) : skillError ? (
                                <div className="text-center text-red-600 py-6 font-bold">{skillError}</div>
                            ) : skillInventory.length === 0 ? (
                                <div className="text-center text-slate-500 py-6">
                                    Bạn chưa có kỹ năng nào trong kho. Hãy mua ở Cửa Hàng Kỹ Năng.
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-2">
                                        {skillInventory.map((entry) => {
                                            const selected = String(selectedSkillId) === String(entry.moveId)
                                            return (
                                                <label
                                                    key={String(entry.moveId)}
                                                    className={`block border rounded p-3 cursor-pointer transition ${selected ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-blue-300'} ${entry.canLearn ? '' : 'opacity-60'}`}
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <input
                                                            type="radio"
                                                            name="teachSkill"
                                                            checked={selected}
                                                            onChange={() => setSelectedSkillId(String(entry.moveId))}
                                                            className="mt-1 accent-blue-600"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center justify-between gap-2">
                                                                <span className="font-bold text-blue-900">{entry.move?.name || 'Unknown Skill'}</span>
                                                                <span className="text-xs font-bold text-slate-600">x{Number(entry.quantity || 0)}</span>
                                                            </div>
                                                            <div className="text-xs text-slate-600 mt-1">
                                                                {String(entry.move?.type || '').toUpperCase()} • {String(entry.move?.category || '').toUpperCase()} • Pow {entry.move?.power ?? '--'} • PP {entry.move?.pp ?? '--'}
                                                            </div>
                                                            {!entry.canLearn && (
                                                                <div className="text-[11px] text-amber-700 font-semibold mt-1">{entry.reason || 'Không thể học kỹ năng này'}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </label>
                                            )
                                        })}
                                    </div>

                                    {currentMoves.length >= 4 && (
                                        <div className="border border-amber-200 bg-amber-50 rounded p-3">
                                            <div className="text-xs font-bold text-amber-800 uppercase mb-2">Chọn kỹ năng cần thay thế</div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                {currentMoves.map((moveName, index) => (
                                                    <button
                                                        key={`${moveName}-${index}`}
                                                        type="button"
                                                        onClick={() => setReplaceMoveIndex(index)}
                                                        className={`px-3 py-2 border rounded text-left text-sm font-semibold transition ${replaceMoveIndex === index
                                                            ? 'border-amber-500 bg-white text-amber-800'
                                                            : 'border-amber-200 bg-white text-slate-700 hover:border-amber-400'
                                                            }`}
                                                    >
                                                        Slot {index + 1}: {moveName}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="border-t border-slate-200 p-3 bg-slate-50 flex gap-2 justify-end">
                            <button
                                type="button"
                                onClick={() => setSkillModalOpen(false)}
                                className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded text-sm font-semibold"
                            >
                                Hủy
                            </button>
                            <button
                                type="button"
                                onClick={handleTeachSkill}
                                disabled={teachingSkill || skillLoading || skillInventory.length === 0}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded text-sm font-bold"
                            >
                                {teachingSkill ? 'Đang dạy...' : 'Xác Nhận Học Kỹ Năng'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    )
}
