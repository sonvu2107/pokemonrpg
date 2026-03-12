import { useMemo, useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import BulkItemUseModal, { getBulkItemUseLimit } from '../components/BulkItemUseModal'
import { gameApi } from '../services/gameApi'
import FeatureUnavailableNotice from '../components/FeatureUnavailableNotice'
import VipCaughtStar from '../components/VipCaughtStar'
import VipAvatar from '../components/VipAvatar'
import VipTitleBadge from '../components/VipTitleBadge'
import { useAuth } from '../context/AuthContext'
import { getPublicRoleLabel } from '../utils/vip'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const LEVEL_TRANSFER_MODAL_PAGE_SIZE = 12
const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')
const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm text-sm uppercase tracking-wide">
        {title}
    </div>
)

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const toOptionalNumber = (value) => {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

const resolvePokemonCombatPower = (pokemonLike, statsLike = {}) => {
    const directPower = Number(pokemonLike?.combatPower ?? pokemonLike?.power)
    if (Number.isFinite(directPower) && directPower > 0) {
        return Math.floor(directPower)
    }

    const level = Math.max(1, Number(pokemonLike?.level || 1))
    const hp = Math.max(1, Number((statsLike?.maxHp ?? statsLike?.hp) || 1))
    const atk = Math.max(1, Number(statsLike?.atk || 1))
    const def = Math.max(1, Number(statsLike?.def || 1))
    const spatk = Math.max(1, Number(statsLike?.spatk || 1))
    const spdef = Math.max(1, Number(statsLike?.spdef || statsLike?.spldef || 1))
    const spd = Math.max(1, Number(statsLike?.spd || 1))
    const rawPower = (hp * 1.2)
        + (atk * 1.8)
        + (def * 1.45)
        + (spatk * 1.8)
        + (spdef * 1.45)
        + (spd * 1.35)
        + (level * 2)
    const shinyBonus = pokemonLike?.isShiny ? 1.03 : 1
    return Math.max(1, Math.floor(rawPower * shinyBonus))
}

const normalizeMoveKey = (value = '') => String(value || '').trim().toLowerCase()
const resolvePokemonDisplaySprite = (pokemonLike = {}, formId = 'normal', isShiny = false) => {
    const species = pokemonLike && typeof pokemonLike === 'object' ? pokemonLike : {}
    const forms = Array.isArray(species?.forms) ? species.forms : []
    const requestedFormId = normalizeFormId(formId || species?.defaultFormId || 'normal')
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === requestedFormId) || null
    const baseNormal = species?.imageUrl || species?.sprites?.normal || species?.sprites?.icon || ''
    const formNormal = resolvedForm?.imageUrl || resolvedForm?.sprites?.normal || resolvedForm?.sprites?.icon || baseNormal
    const shinySprite = resolvedForm?.sprites?.shiny || species?.sprites?.shiny || formNormal
    return (isShiny ? shinySprite : formNormal) || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
}
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
        <div className="w-1/6 bg-slate-50 p-2 font-bold text-blue-800 border-r border-blue-200 flex items-center">
            {label}:
        </div>
        <div className="w-1/3 p-2 font-bold text-slate-700 border-r border-blue-200 flex items-center justify-center">
            {value}
        </div>
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
    const [skillModalOpen, setSkillModalOpen] = useState(false)
    const [skillInventory, setSkillInventory] = useState([])
    const [skillLoading, setSkillLoading] = useState(false)
    const [skillError, setSkillError] = useState('')
    const [selectedSkillId, setSelectedSkillId] = useState('')
    const [replaceMoveIndex, setReplaceMoveIndex] = useState(-1)
    const [teachingSkill, setTeachingSkill] = useState(false)
    const [removingSkillName, setRemovingSkillName] = useState('')
    const [offTypeSkillItems, setOffTypeSkillItems] = useState([])
    const [offTypeSkillItemsLoading, setOffTypeSkillItemsLoading] = useState(false)
    const [selectedOffTypeSkillItemId, setSelectedOffTypeSkillItemId] = useState('')
    const [usingOffTypeSkillItem, setUsingOffTypeSkillItem] = useState(false)
    const [pokemonGrowthItems, setPokemonGrowthItems] = useState([])
    const [selectedGrowthItemId, setSelectedGrowthItemId] = useState('')
    const [usingGrowthItem, setUsingGrowthItem] = useState(false)
    const [growthItemModalOpen, setGrowthItemModalOpen] = useState(false)
    const [pokemonLevelTransferItems, setPokemonLevelTransferItems] = useState([])
    const [levelTransferCandidates, setLevelTransferCandidates] = useState([])
    const [levelTransferCandidatesLoading, setLevelTransferCandidatesLoading] = useState(false)
    const [levelTransferModalOpen, setLevelTransferModalOpen] = useState(false)
    const [levelTransferSearchTerm, setLevelTransferSearchTerm] = useState('')
    const [levelTransferPage, setLevelTransferPage] = useState(1)
    const [levelTransferPagination, setLevelTransferPagination] = useState({ page: 1, limit: LEVEL_TRANSFER_MODAL_PAGE_SIZE, total: 0, totalPages: 1 })
    const [selectedLevelTransferItemId, setSelectedLevelTransferItemId] = useState('')
    const [selectedLevelTransferSourceId, setSelectedLevelTransferSourceId] = useState('')
    const [selectedLevelTransferSourceEntry, setSelectedLevelTransferSourceEntry] = useState(null)
    const [usingLevelTransferItem, setUsingLevelTransferItem] = useState(false)

    useEffect(() => {
        loadPokemon()
    }, [id])

    const viewerId = String(user?.id || user?._id || '').trim()
    const currentVipTierLevel = Math.max(0, Number(user?.vipTierLevel || 0))
    const growthBatchUseLimit = getBulkItemUseLimit(currentVipTierLevel)
    const ownerId = String(pokemon?.userId?._id || '').trim()
    const isOwnerViewing = Boolean(viewerId && ownerId && viewerId === ownerId)
    const canViewMoves = pokemon?.canViewMoves !== false
    const offTypeSkillAllowance = Math.max(0, Number(pokemon?.offTypeSkillAllowance || 0)) || (pokemon?.allowOffTypeSkills ? 1 : 0)
    const hasOffTypeSkillAccess = offTypeSkillAllowance > 0
    const selectedGrowthItem = useMemo(
        () => pokemonGrowthItems.find((entry) => entry.itemId === selectedGrowthItemId) || null,
        [pokemonGrowthItems, selectedGrowthItemId]
    )

    const loadPokemon = async () => {
        try {
            setLoading(true)
            setError(null)
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

    const loadPokemonTargetItems = async () => {
        if (!isOwnerViewing) {
            setOffTypeSkillItems([])
            setSelectedOffTypeSkillItemId('')
            setPokemonGrowthItems([])
            setSelectedGrowthItemId('')
            setPokemonLevelTransferItems([])
            setSelectedLevelTransferItemId('')
            setLevelTransferCandidates([])
            setSelectedLevelTransferSourceId('')
            setSelectedLevelTransferSourceEntry(null)
            setLevelTransferPagination({ page: 1, limit: LEVEL_TRANSFER_MODAL_PAGE_SIZE, total: 0, totalPages: 1 })
            setOffTypeSkillItemsLoading(false)
            return
        }

        try {
            setOffTypeSkillItemsLoading(true)
            const data = await gameApi.getInventory()
            const nextItems = (Array.isArray(data?.inventory) ? data.inventory : [])
                .map((entry) => ({
                    itemId: String(entry?.item?._id || '').trim(),
                    name: String(entry?.item?.name || 'Vật phẩm').trim() || 'Vật phẩm',
                    quantity: Math.max(0, Number(entry?.quantity || 0)),
                    effectType: String(entry?.item?.effectType || '').trim(),
                    effectValue: Math.max(0, Number(entry?.item?.effectValue || 0)),
                }))
                .filter((entry) => entry.itemId && entry.quantity > 0)

            const nextOffTypeItems = nextItems.filter((entry) => entry.effectType === 'allowOffTypeSkills')
            const nextGrowthItems = nextItems.filter((entry) => ['grantPokemonExp', 'grantPokemonLevel'].includes(entry.effectType))
            const nextLevelTransferItems = nextItems.filter((entry) => entry.effectType === 'transferPokemonLevel')

            setOffTypeSkillItems(nextOffTypeItems)
            setSelectedOffTypeSkillItemId((current) => {
                if (nextOffTypeItems.some((entry) => entry.itemId === current)) return current
                return nextOffTypeItems[0]?.itemId || ''
            })
            setPokemonGrowthItems(nextGrowthItems)
            setSelectedGrowthItemId((current) => {
                if (nextGrowthItems.some((entry) => entry.itemId === current)) return current
                return nextGrowthItems[0]?.itemId || ''
            })
            setPokemonLevelTransferItems(nextLevelTransferItems)
            setSelectedLevelTransferItemId((current) => {
                if (nextLevelTransferItems.some((entry) => entry.itemId === current)) return current
                return nextLevelTransferItems[0]?.itemId || ''
            })
        } catch (err) {
            console.error(err)
            setOffTypeSkillItems([])
            setSelectedOffTypeSkillItemId('')
            setPokemonGrowthItems([])
            setSelectedGrowthItemId('')
            setPokemonLevelTransferItems([])
            setSelectedLevelTransferItemId('')
        } finally {
            setOffTypeSkillItemsLoading(false)
        }
    }

    const loadLevelTransferCandidates = async (page = 1, search = '') => {
        if (!isOwnerViewing) {
            setLevelTransferCandidates([])
            setSelectedLevelTransferSourceId('')
            setSelectedLevelTransferSourceEntry(null)
            setLevelTransferPagination({ page: 1, limit: LEVEL_TRANSFER_MODAL_PAGE_SIZE, total: 0, totalPages: 1 })
            return
        }

        try {
            setLevelTransferCandidatesLoading(true)
            const data = await gameApi.getPokemonLevelTransferCandidates(id, {
                page,
                limit: LEVEL_TRANSFER_MODAL_PAGE_SIZE,
                search,
            })
            const nextCandidates = Array.isArray(data?.candidates) ? data.candidates : []
            const nextPagination = {
                page: Math.max(1, Number(data?.pagination?.page || page)),
                limit: Math.max(1, Number(data?.pagination?.limit || LEVEL_TRANSFER_MODAL_PAGE_SIZE)),
                total: Math.max(0, Number(data?.pagination?.total || 0)),
                totalPages: Math.max(1, Number(data?.pagination?.totalPages || 1)),
            }
            const persistedSelectedId = String(selectedLevelTransferSourceId || '').trim()
            const fallbackSelectedId = persistedSelectedId || String(nextCandidates[0]?._id || '')
            const matchedSelectedCandidate = nextCandidates.find((entry) => String(entry?._id) === fallbackSelectedId) || null
            setLevelTransferCandidates(nextCandidates)
            setLevelTransferPagination(nextPagination)
            if (nextPagination.page !== page) {
                setLevelTransferPage(nextPagination.page)
            }
            setSelectedLevelTransferSourceId(fallbackSelectedId)
            if (matchedSelectedCandidate) {
                setSelectedLevelTransferSourceEntry(matchedSelectedCandidate)
            } else if (!persistedSelectedId) {
                setSelectedLevelTransferSourceEntry(nextCandidates[0] || null)
            }
        } catch (err) {
            console.error(err)
            setLevelTransferCandidates([])
            setSelectedLevelTransferSourceId('')
            setSelectedLevelTransferSourceEntry(null)
            setLevelTransferPagination({ page: 1, limit: LEVEL_TRANSFER_MODAL_PAGE_SIZE, total: 0, totalPages: 1 })
        } finally {
            setLevelTransferCandidatesLoading(false)
        }
    }

    useEffect(() => {
        loadPokemonTargetItems()
    }, [id, isOwnerViewing])

    useEffect(() => {
        if (!levelTransferModalOpen) return
        loadLevelTransferCandidates(levelTransferPage, levelTransferSearchTerm)
    }, [id, isOwnerViewing, levelTransferModalOpen, levelTransferPage, levelTransferSearchTerm])

    const openSkillModal = async () => {
        setSkillModalOpen(true)
        setReplaceMoveIndex(-1)
        await loadSkillInventory()
    }

    const openLevelTransferModal = () => {
        setLevelTransferSearchTerm('')
        setLevelTransferModalOpen(true)
        setLevelTransferPage(1)
    }

    const handleUseOffTypeSkillItem = async () => {
        if (!pokemon?._id || !selectedOffTypeSkillItemId) return

        const selectedItem = offTypeSkillItems.find((entry) => entry.itemId === selectedOffTypeSkillItemId)
        if (!selectedItem) {
            window.alert('Không tìm thấy vật phẩm phù hợp.')
            return
        }

        const targetName = String(pokemon?.nickname || pokemon?.pokemonId?.name || 'Pokemon').trim() || 'Pokemon'
        const confirmed = window.confirm(`Dùng ${selectedItem.name} cho ${targetName}?`)
        if (!confirmed) return

        try {
            setUsingOffTypeSkillItem(true)
            const data = await gameApi.useItem(selectedItem.itemId, 1, null, pokemon._id)
            window.alert(data?.message || 'Đã dùng vật phẩm thành công.')
            await loadPokemon()
            await loadPokemonTargetItems()
            if (skillModalOpen) {
                await loadSkillInventory()
            }
        } catch (err) {
            window.alert(err.message || 'Không thể dùng vật phẩm.')
        } finally {
            setUsingOffTypeSkillItem(false)
        }
    }

    const handleUseGrowthItem = async (quantity = 1) => {
        if (!pokemon?._id || !selectedGrowthItemId) return

        const selectedItem = pokemonGrowthItems.find((entry) => entry.itemId === selectedGrowthItemId)
        if (!selectedItem) {
            window.alert('Không tìm thấy vật phẩm phù hợp.')
            return
        }

        try {
            setUsingGrowthItem(true)
            const data = await gameApi.useItem(selectedItem.itemId, quantity, null, pokemon._id)
            window.alert(data?.message || 'Đã dùng vật phẩm thành công.')
            setGrowthItemModalOpen(false)
            await loadPokemon()
            await loadPokemonTargetItems()
        } catch (err) {
            window.alert(err.message || 'Không thể dùng vật phẩm.')
        } finally {
            setUsingGrowthItem(false)
        }
    }

    const openGrowthItemModal = () => {
        if (!selectedGrowthItemId || !selectedGrowthItem) return
        setGrowthItemModalOpen(true)
    }

    const handleUseLevelTransferItem = async () => {
        if (!pokemon?._id || !selectedLevelTransferItemId || !selectedLevelTransferSourceId) return

        const selectedItem = pokemonLevelTransferItems.find((entry) => entry.itemId === selectedLevelTransferItemId)
        const selectedSource = selectedLevelTransferSourceEntry
        if (!selectedItem || !selectedSource) {
            window.alert('Không tìm thấy dữ liệu chuyển level phù hợp.')
            return
        }

        const targetName = String(pokemon?.nickname || pokemon?.pokemonId?.name || 'Pokemon').trim() || 'Pokemon'
        const sourceName = String(selectedSource?.nickname || selectedSource?.pokemon?.name || 'Pokemon').trim() || 'Pokemon'
        const transferableLevels = Math.max(0, Number(selectedSource?.level || 1) - 1)
        const confirmed = window.confirm(`Dùng ${selectedItem.name} để chuyển ${transferableLevels} cấp từ ${sourceName} sang ${targetName}? ${sourceName} sẽ về Lv. 1.`)
        if (!confirmed) return

        try {
            setUsingLevelTransferItem(true)
            const data = await gameApi.useItem(selectedItem.itemId, 1, null, pokemon._id, '', null, selectedSource._id)
            window.alert(data?.message || 'Đã dùng vật phẩm thành công.')
            setSelectedLevelTransferSourceId('')
            setSelectedLevelTransferSourceEntry(null)
            setLevelTransferModalOpen(false)
            await Promise.all([
                loadPokemon(),
                loadPokemonTargetItems(),
            ])
        } catch (err) {
            window.alert(err.message || 'Không thể dùng vật phẩm.')
        } finally {
            setUsingLevelTransferItem(false)
        }
    }

    const handleTeachSkill = async () => {
        const selectedSkill = skillInventory.find((entry) => String(entry.moveId) === String(selectedSkillId))
        if (!selectedSkill) {
            window.alert('Vui lòng chọn một kỹ năng để học.')
            return
        }
        if (!selectedSkill.canLearn) {
            window.alert(selectedSkill.reason || 'Pokemon này đã biết kỹ năng đã chọn.')
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
                window.alert('Pokemon đã đủ 4 kỹ năng. Hãy chọn kỹ năng cần thay thế.')
                return
            }
            payload.replaceMoveIndex = replaceMoveIndex
        }

        try {
            setTeachingSkill(true)
            const data = await gameApi.teachPokemonSkill(id, payload)
            setPokemon((prev) => {
                if (!prev) return prev

                const nextMoves = Array.isArray(data?.pokemon?.moves) ? data.pokemon.moves : prev.moves
                const nextMovePpState = Array.isArray(data?.pokemon?.movePpState) ? data.pokemon.movePpState : prev.movePpState
                const moveDetailsMap = new Map(
                    (Array.isArray(prev.moveDetails) ? prev.moveDetails : [])
                        .map((entry) => {
                            const name = String(entry?.name || '').trim()
                            const key = normalizeMoveKey(name)
                            if (!key) return null
                            return [key, {
                                name,
                                type: String(entry?.type || '').trim().toLowerCase(),
                                category: String(entry?.category || '').trim().toLowerCase(),
                                power: toOptionalNumber(entry?.power),
                                accuracy: toOptionalNumber(entry?.accuracy),
                            }]
                        })
                        .filter(Boolean)
                )

                const replacedMoveName = String(data?.replacedMove || '').trim()
                if (replacedMoveName) {
                    moveDetailsMap.delete(normalizeMoveKey(replacedMoveName))
                }

                const taughtMove = data?.taughtMove || null
                const taughtMoveName = String(taughtMove?.name || '').trim()
                if (taughtMoveName) {
                    moveDetailsMap.set(normalizeMoveKey(taughtMoveName), {
                        name: taughtMoveName,
                        type: String(taughtMove?.type || '').trim().toLowerCase(),
                        category: String(taughtMove?.category || '').trim().toLowerCase(),
                        power: toOptionalNumber(taughtMove?.power),
                        accuracy: toOptionalNumber(taughtMove?.accuracy),
                    })
                }

                const nextMoveDetails = (Array.isArray(nextMoves) ? nextMoves : [])
                    .map((moveNameRaw) => {
                        const moveName = String(moveNameRaw || '').trim()
                        if (!moveName) return null
                        const existing = moveDetailsMap.get(normalizeMoveKey(moveName))
                        if (existing) {
                            return {
                                ...existing,
                                name: moveName,
                            }
                        }
                        return {
                            name: moveName,
                            type: '',
                            category: '',
                            power: null,
                            accuracy: null,
                        }
                    })
                    .filter(Boolean)

                return {
                    ...prev,
                    moves: nextMoves,
                    movePpState: nextMovePpState,
                    moveDetails: nextMoveDetails,
                    offTypeSkillAllowance: Math.max(0, Number(data?.pokemon?.offTypeSkillAllowance || prev.offTypeSkillAllowance || 0)),
                    allowOffTypeSkills: Boolean(data?.pokemon?.allowOffTypeSkills),
                }
            })
            window.alert(data?.message || 'Pokemon đã học kỹ năng mới.')
            setReplaceMoveIndex(-1)
            await loadSkillInventory()
        } catch (err) {
            window.alert(err.message || 'Dạy kỹ năng thất bại.')
        } finally {
            setTeachingSkill(false)
        }
    }

    const handleRemoveSkill = async (moveName) => {
        const safeMoveName = String(moveName || '').trim()
        if (!safeMoveName) return
        const confirmed = window.confirm(`Gỡ kỹ năng ${safeMoveName} khỏi Pokemon này?`)
        if (!confirmed) return

        try {
            setRemovingSkillName(safeMoveName)
            const data = await gameApi.removePokemonSkill(id, { moveName: safeMoveName })
            setPokemon((prev) => {
                if (!prev) return prev

                const nextMoves = Array.isArray(data?.pokemon?.moves) ? data.pokemon.moves : prev.moves
                const nextMovePpState = Array.isArray(data?.pokemon?.movePpState) ? data.pokemon.movePpState : prev.movePpState
                const moveDetailsMap = new Map(
                    (Array.isArray(prev.moveDetails) ? prev.moveDetails : [])
                        .map((entry) => {
                            const name = String(entry?.name || '').trim()
                            const key = normalizeMoveKey(name)
                            if (!key) return null
                            return [key, {
                                name,
                                type: String(entry?.type || '').trim().toLowerCase(),
                                category: String(entry?.category || '').trim().toLowerCase(),
                                power: toOptionalNumber(entry?.power),
                                accuracy: toOptionalNumber(entry?.accuracy),
                            }]
                        })
                        .filter(Boolean)
                )

                const removedMoveName = String(data?.removedMove || safeMoveName).trim()
                if (removedMoveName) {
                    moveDetailsMap.delete(normalizeMoveKey(removedMoveName))
                }

                const nextMoveDetails = (Array.isArray(nextMoves) ? nextMoves : [])
                    .map((moveNameRaw) => {
                        const moveName = String(moveNameRaw || '').trim()
                        if (!moveName) return null
                        const existing = moveDetailsMap.get(normalizeMoveKey(moveName))
                        if (existing) {
                            return {
                                ...existing,
                                name: moveName,
                            }
                        }
                        return {
                            name: moveName,
                            type: '',
                            category: '',
                            power: null,
                            accuracy: null,
                        }
                    })
                    .filter(Boolean)

                return {
                    ...prev,
                    moves: nextMoves,
                    movePpState: nextMovePpState,
                    moveDetails: nextMoveDetails,
                }
            })
            window.alert(data?.message || `Đã gỡ kỹ năng ${safeMoveName}.`)
        } catch (err) {
            window.alert(err.message || 'Gỡ kỹ năng thất bại.')
        } finally {
            setRemovingSkillName('')
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
    const protectedMoveKeySet = new Set([
        'struggle',
    ])
    const isProtectedMoveName = (value = '') => protectedMoveKeySet.has(String(value || '').trim().toLowerCase())
    const hasProtectedMoveVisible = currentMoves.some((entry) => protectedMoveKeySet.has(String(entry || '').trim().toLowerCase()))
    const virtualDefaultMoveName = hasProtectedMoveVisible ? '' : 'Struggle'
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
    const currentMoveDetails = (() => {
        const rawMoveDetails = Array.isArray(pokemon?.moveDetails) ? pokemon.moveDetails : []
        if (rawMoveDetails.length > 0) {
            return rawMoveDetails
                .map((entry) => {
                    const name = String(entry?.name || '').trim()
                    if (!name) return null
                    const key = name.toLowerCase()
                    const ppState = movePpMap.get(key)
                    return {
                        name,
                        type: String(entry?.type || '').trim().toLowerCase(),
                        category: String(entry?.category || '').trim().toLowerCase(),
                        power: toOptionalNumber(entry?.power),
                        accuracy: toOptionalNumber(entry?.accuracy),
                        currentPp: Number.isFinite(Number(ppState?.currentPp)) ? Number(ppState.currentPp) : Math.max(0, Number(entry?.currentPp || 0)),
                        maxPp: Number.isFinite(Number(ppState?.maxPp)) ? Number(ppState.maxPp) : Math.max(1, Number(entry?.maxPp || 1)),
                    }
                })
                .filter(Boolean)
        }

        return currentMoves.map((moveName) => {
            const key = String(moveName || '').trim().toLowerCase()
            const ppState = movePpMap.get(key)
            return {
                name: moveName,
                type: '',
                category: '',
                power: null,
                accuracy: null,
                currentPp: Number.isFinite(Number(ppState?.currentPp)) ? Number(ppState.currentPp) : 0,
                maxPp: Number.isFinite(Number(ppState?.maxPp)) ? Number(ppState.maxPp) : 1,
            }
        })
    })()
    const moveDetailsWithDefault = [...currentMoveDetails]
    if (virtualDefaultMoveName && !moveDetailsWithDefault.some((entry) => String(entry?.name || '').trim().toLowerCase() === 'struggle')) {
        moveDetailsWithDefault.unshift({
            name: virtualDefaultMoveName,
            type: 'normal',
            category: 'physical',
            power: 35,
            accuracy: 100,
            currentPp: 99,
            maxPp: 99,
        })
    }
    const orderedMoveDetails = [...moveDetailsWithDefault].sort((left, right) => {
        const leftProtected = isProtectedMoveName(left?.name)
        const rightProtected = isProtectedMoveName(right?.name)
        if (leftProtected && !rightProtected) return -1
        if (!leftProtected && rightProtected) return 1
        return 0
    })
    const orderedCurrentMoves = [...currentMoves].sort((left, right) => {
        const leftProtected = isProtectedMoveName(left)
        const rightProtected = isProtectedMoveName(right)
        if (leftProtected && !rightProtected) return -1
        if (!leftProtected && rightProtected) return 1
        return 0
    })
    const moveDisplaySlots = Array.from({ length: 4 }, (_, index) => orderedMoveDetails[index] || null)
    const forms = Array.isArray(base?.forms) ? base.forms : []
    const resolvedFormId = normalizeFormId(pokemon.formId || base?.defaultFormId || 'normal')
    const resolvedForm = forms.find((entry) => normalizeFormId(entry?.formId) === resolvedFormId) || null
    const resolvedFormName = String(resolvedForm?.formName || resolvedForm?.formId || resolvedFormId).trim()
    const formNormalSprite = resolvedForm?.imageUrl || resolvedForm?.sprites?.normal || resolvedForm?.sprites?.icon || base?.imageUrl || base?.sprites?.normal || base?.sprites?.icon || ''
    const formShinySprite = resolvedForm?.sprites?.shiny || base?.sprites?.shiny || formNormalSprite
    const stats = pokemon.stats
    const combatPower = resolvePokemonCombatPower(pokemon, stats)
    const sprite = pokemon.isShiny ? formShinySprite : formNormalSprite
    const previousPokemon = pokemon.evolution?.previousPokemon || null
    const previousSprite = previousPokemon?.sprites?.normal || ''
    const ownerInfo = pokemon?.userId && typeof pokemon.userId === 'object' ? pokemon.userId : null
    const ownerUsername = String(ownerInfo?.username || 'Không rõ').trim() || 'Không rõ'
    const ownerIdLabel = String(ownerInfo?._id || '').trim()
    const ownerAvatar = String(ownerInfo?.avatar || '').trim() || DEFAULT_AVATAR
    const selectedLevelTransferSource = selectedLevelTransferSourceEntry
    const levelTransferSelectedSourceName = String(selectedLevelTransferSource?.nickname || selectedLevelTransferSource?.pokemon?.name || '').trim()
    const levelTransferSelectedSourceSprite = selectedLevelTransferSource
        ? resolvePokemonDisplaySprite(selectedLevelTransferSource?.pokemon, selectedLevelTransferSource?.formId, selectedLevelTransferSource?.isShiny)
        : ''
    const levelTransferTotal = Math.max(0, Number(levelTransferPagination?.total || 0))
    const levelTransferPageSize = Math.max(1, Number(levelTransferPagination?.limit || LEVEL_TRANSFER_MODAL_PAGE_SIZE))
    const levelTransferCurrentPage = Math.max(1, Number(levelTransferPagination?.page || levelTransferPage || 1))
    const levelTransferTotalPages = Math.max(1, Number(levelTransferPagination?.totalPages || 1))
    const levelTransferStart = levelTransferTotal > 0 ? ((levelTransferCurrentPage - 1) * levelTransferPageSize) + 1 : 0
    const levelTransferEnd = levelTransferTotal > 0 ? Math.min(levelTransferTotal, levelTransferStart + levelTransferCandidates.length - 1) : 0
    const parseTrainerOrigin = (value = '') => {
        const raw = String(value || '').trim()
        if (!raw) return { token: '', payload: '' }
        const [prefix, ...rest] = raw.split(':')
        return {
            token: String(prefix || '').trim().toLowerCase(),
            payload: String(rest.join(':') || '').trim(),
        }
    }
    const translateOriginPlace = (token = '') => {
        const wildCaughtMapName = String(pokemon?.obtainedMapName || '').trim()
        switch (String(token || '').trim().toLowerCase()) {
            case 'trade':
                return 'Trao đổi'
            case 'daily_checkin':
                return 'Điểm danh hằng ngày'
            case 'promo_code':
                return 'Mã quà tặng'
            case 'battle_trainer_reward':
                return 'Thưởng huấn luyện viên'
            case 'admin_grant':
            case 'system_grant':
                return ''
            default:
                return wildCaughtMapName || 'Bắt hoang dã'
        }
    }
    const translateOriginTrainer = ({ token, payload }) => {
        const normalizedToken = String(token || '').trim().toLowerCase()
        if (normalizedToken === 'admin_grant' || normalizedToken === 'system_grant') return ''
        if (!normalizedToken) {
            return String(pokemon.userId?.username || '').trim() || 'Không rõ'
        }
        if (normalizedToken === 'trade') {
            return payload || 'Người chơi khác'
        }
        if (normalizedToken === 'daily_checkin' || normalizedToken === 'promo_code' || normalizedToken === 'battle_trainer_reward') {
            return 'Hệ thống'
        }
        return payload || String(pokemon.userId?.username || '').trim() || 'Không rõ'
    }
    const trainerOrigin = parseTrainerOrigin(pokemon.originalTrainer)
    const hideOriginInfo = trainerOrigin.token === 'admin_grant' || trainerOrigin.token === 'system_grant'
    const originalTrainerDisplay = hideOriginInfo ? '' : translateOriginTrainer(trainerOrigin)
    const obtainedLabel = hideOriginInfo ? '' : translateOriginPlace(trainerOrigin.token)
    const nicknameDisplay = String(pokemon.nickname || '').trim()
    const hasCustomNickname = Boolean(
        nicknameDisplay && nicknameDisplay.toLowerCase() !== String(base.name || '').trim().toLowerCase()
    )
    const serverStats = pokemon.serverStats || {}
    const hasServerStats = Object.prototype.hasOwnProperty.call(serverStats, 'speciesTotal')
    const speciesTotal = Number(serverStats.speciesTotal) || 0
    const speciesRank = Number(serverStats.speciesRank)
    const totalPokemonInServer = Number(serverStats.totalPokemon) || 0
    const historyEvents = Array.isArray(pokemon?.history?.events) ? pokemon.history.events : []
    const viewerSpeciesOwnedCount = Number(serverStats.viewerSpeciesOwnedCount || 0)
    const pokemonTypes = Array.isArray(base?.types)
        ? base.types.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
        : []

    const typeBadgeClass = {
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

    const rarityColor = {
        d: 'text-slate-500',
        c: 'text-green-600',
        b: 'text-blue-600',
        a: 'text-purple-600',
        s: 'text-orange-500',
        ss: 'text-red-600',
        'sss+': 'text-amber-500',
        sss: 'text-yellow-500'
    }[base.rarity] || 'text-slate-700'

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12 pt-6">
            <div className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                <SectionHeader title={`Thông Tin Pokemon ${base.name} (ID #${base.pokedexNumber})`} />
                <div className="bg-slate-50 border-b border-blue-200 p-1 text-center font-bold text-blue-800 text-xs uppercase bg-blue-100/50">
                    Tổng Quan
                </div>
                <div className="p-4">
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
                        </div>
                        <h2 className="text-2xl font-bold text-blue-900 flex items-center gap-2">
                            {base.name}
                            <VipCaughtStar level={pokemon?.obtainedVipMapLevel} className="text-sm" />
                            {pokemon.isShiny && <span className="text-amber-500 text-sm">★</span>}
                        </h2>

                        {hasCustomNickname && (
                            <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-slate-600">
                                <span>{nicknameDisplay}</span>
                                <VipCaughtStar level={pokemon?.obtainedVipMapLevel} className="text-[11px]" />
                            </div>
                        )}
                        {resolvedFormId !== 'normal' && (
                            <div className="mt-1">
                                <span className="text-[11px] uppercase bg-sky-100 text-sky-700 px-2 py-0.5 rounded border border-sky-200">
                                    {resolvedFormName}
                                </span>
                            </div>
                        )}
                        <div className="text-xs font-bold mt-1 flex gap-2">
                            <span className="bg-slate-200 px-2 py-0.5 rounded text-slate-700">Lv. {pokemon.level}</span>
                            <span className="bg-rose-100 px-2 py-0.5 rounded text-rose-700">LC {combatPower.toLocaleString('vi-VN')}</span>
                            <span className={`bg-slate-100 px-2 py-0.5 rounded uppercase ${rarityColor}`}>
                                {base.rarity.toUpperCase()}
                            </span>
                        </div>
                        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                            {pokemonTypes.length > 0 ? pokemonTypes.map((type) => (
                                <span
                                    key={type}
                                    className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${typeBadgeClass[type] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
                                >
                                    {type}
                                </span>
                            )) : (
                                <span className="text-[10px] text-slate-400">Chưa có dữ liệu hệ</span>
                            )}
                        </div>
                        {hasOffTypeSkillAccess && (
                            <div className="mt-2 inline-flex items-center rounded border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-800">
                                Còn {offTypeSkillAllowance} lượt học skill khác hệ
                            </div>
                        )}
                    </div>
                    <div className="border border-blue-300 rounded mb-4 overflow-hidden">
                        <div className="bg-blue-100/50 p-1 text-center text-xs font-bold text-blue-800 border-b border-blue-200">
                            Chủ Sở Hữu
                        </div>
                        <div className="p-2 text-center text-sm font-bold text-slate-700 flex flex-col items-center gap-1">
                            <VipAvatar
                                userLike={ownerInfo}
                                avatar={ownerAvatar}
                                fallback={DEFAULT_AVATAR}
                                alt={ownerUsername}
                                wrapperClassName="w-12 h-12"
                                imageClassName="w-12 h-12 rounded-full border border-blue-200 object-cover bg-slate-100 pixelated"
                                frameClassName="w-12 h-12 rounded-full object-cover"
                            />
                            <div className="flex items-center justify-center gap-2 flex-wrap">
                                <span className="text-blue-600">{ownerUsername}</span>
                                <VipTitleBadge userLike={ownerInfo} />
                            </div>
                            <span className="text-[10px] text-slate-500">Nhóm: {getPublicRoleLabel(ownerInfo)}</span>
                            <span className="text-[10px] text-slate-400">ID: {ownerIdLabel ? ownerIdLabel.slice(-8).toUpperCase() : '--------'}</span>
                        </div>
                    </div>
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
                        <StatRow
                            label="Lực Chiến" value={combatPower.toLocaleString('vi-VN')}
                            label2="Cấp" value2={`Lv. ${pokemon.level}`}
                        />
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
                        <div className="flex border-b border-blue-200 last:border-0 text-xs text-center">
                            {canViewMoves ? moveDisplaySlots.map((slot, index) => {
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
                            }) : (
                                <div className="w-full p-3 font-bold text-slate-400">
                                    Kỹ năng đang mặc đã được ẩn
                                </div>
                            )}
                        </div>
                        {isOwnerViewing && (
                            <div className="p-2 bg-slate-50 border-t border-blue-200 text-center space-y-2">
                                <div className={`rounded border px-3 py-2 text-left ${hasOffTypeSkillAccess ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                                    <div className="text-[11px] font-bold uppercase">Skill khác hệ</div>
                                    {hasOffTypeSkillAccess ? (
                                        <div className="mt-1 text-xs font-semibold">Pokemon này còn {offTypeSkillAllowance} lượt học skill khác hệ.</div>
                                    ) : offTypeSkillItemsLoading ? (
                                        <div className="mt-1 text-xs">Đang tải vật phẩm hỗ trợ...</div>
                                    ) : null}
                                    {offTypeSkillItemsLoading ? null : offTypeSkillItems.length > 0 ? (
                                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                                            <select
                                                value={selectedOffTypeSkillItemId}
                                                onChange={(e) => setSelectedOffTypeSkillItemId(e.target.value)}
                                                className="flex-1 px-3 py-2 border border-amber-200 rounded text-sm bg-white text-slate-700"
                                            >
                                                {offTypeSkillItems.map((entry) => (
                                                    <option key={entry.itemId} value={entry.itemId}>
                                                        {entry.name} x{entry.quantity}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={handleUseOffTypeSkillItem}
                                                disabled={!selectedOffTypeSkillItemId || usingOffTypeSkillItem}
                                                className="px-3 py-2 text-xs font-bold rounded bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-60"
                                            >
                                                {usingOffTypeSkillItem ? 'Đang dùng...' : 'Dùng vật phẩm'}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="mt-2 text-xs">Bạn chưa có vật phẩm mở khóa skill khác hệ trong túi đồ.</div>
                                    )}
                                </div>
                                <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-left text-sky-800">
                                    <div className="text-[11px] font-bold uppercase">Tăng trưởng Pokemon</div>
                                    {offTypeSkillItemsLoading ? (
                                        <div className="mt-1 text-xs">Đang tải vật phẩm tăng trưởng...</div>
                                    ) : pokemonGrowthItems.length > 0 ? (
                                        <div className="mt-2 flex flex-col sm:flex-row gap-2">
                                            <select
                                                value={selectedGrowthItemId}
                                                onChange={(e) => setSelectedGrowthItemId(e.target.value)}
                                                className="flex-1 px-3 py-2 border border-sky-200 rounded text-sm bg-white text-slate-700"
                                            >
                                                {pokemonGrowthItems.map((entry) => (
                                                    <option key={entry.itemId} value={entry.itemId}>
                                                        {entry.name} x{entry.quantity}
                                                        {entry.effectType === 'grantPokemonLevel'
                                                            ? ` (+${entry.effectValue} Lv)`
                                                            : ` (+${entry.effectValue} EXP)`}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={openGrowthItemModal}
                                                disabled={!selectedGrowthItemId || usingGrowthItem}
                                                className="px-3 py-2 text-xs font-bold rounded bg-sky-600 hover:bg-sky-700 text-white disabled:opacity-60"
                                            >
                                                {usingGrowthItem ? 'Đang dùng...' : `Dùng tăng trưởng${selectedGrowthItem ? ` (tối đa ${Math.min(Number(selectedGrowthItem.quantity || 0), growthBatchUseLimit)})` : ''}`}
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="mt-1 text-xs">Bạn chưa có vật phẩm cộng EXP hoặc tăng cấp trong túi đồ.</div>
                                    )}
                                </div>
                                <div className="rounded border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-left text-fuchsia-800">
                                    <div className="text-[11px] font-bold uppercase">Chuyển level Pokemon</div>
                                    {offTypeSkillItemsLoading ? (
                                        <div className="mt-1 text-xs">Đang tải vật phẩm chuyển level...</div>
                                    ) : pokemonLevelTransferItems.length === 0 ? (
                                        <div className="mt-1 text-xs">Bạn chưa có vật phẩm chuyển level Pokemon trong túi đồ.</div>
                                    ) : (
                                        <div className="mt-2 space-y-2">
                                            <select
                                                value={selectedLevelTransferItemId}
                                                onChange={(e) => setSelectedLevelTransferItemId(e.target.value)}
                                                className="w-full px-3 py-2 border border-fuchsia-200 rounded text-sm bg-white text-slate-700"
                                            >
                                                {pokemonLevelTransferItems.map((entry) => (
                                                    <option key={entry.itemId} value={entry.itemId}>
                                                        {entry.name} x{entry.quantity}
                                                    </option>
                                                ))}
                                            </select>
                                            <div className="rounded border border-fuchsia-200 bg-white px-3 py-2">
                                                <div className="text-[11px] font-bold uppercase text-fuchsia-700">Chọn Pokemon</div>
                                                <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                    {selectedLevelTransferSource ? (
                                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                                            <img
                                                                src={levelTransferSelectedSourceSprite}
                                                                alt={levelTransferSelectedSourceName || 'Pokemon'}
                                                                className="w-12 h-12 object-contain pixelated rounded border border-fuchsia-100 bg-fuchsia-50"
                                                            />
                                                            <div className="min-w-0 flex-1">
                                                                <div className="text-sm font-bold text-slate-800 truncate">
                                                                    {levelTransferSelectedSourceName || 'Pokemon'}
                                                                </div>
                                                                <div className="text-xs text-slate-500 truncate">
                                                                    {selectedLevelTransferSource?.pokemon?.name || 'Không rõ'} • Lv. {selectedLevelTransferSource?.level || 1} • Chuyển {Math.max(0, Number(selectedLevelTransferSource?.level || 1) - 1)} cấp
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs text-slate-500 min-w-0 flex-1">Chưa chọn Pokemon.</div>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={openLevelTransferModal}
                                                        className="w-full sm:w-auto sm:min-w-[190px] px-3 py-2 text-xs font-bold rounded border border-fuchsia-300 bg-white text-fuchsia-700 hover:bg-fuchsia-50"
                                                    >
                                                        Chọn Pokemon
                                                    </button>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleUseLevelTransferItem}
                                                disabled={!selectedLevelTransferItemId || !selectedLevelTransferSourceId || usingLevelTransferItem}
                                                className="px-3 py-2 text-xs font-bold rounded bg-fuchsia-600 hover:bg-fuchsia-700 text-white disabled:opacity-60"
                                            >
                                                {usingLevelTransferItem ? 'Đang chuyển...' : 'Chuyển level'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={openSkillModal}
                                    className="px-3 py-1.5 text-xs font-bold rounded bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                                >
                                    Học Kỹ Năng Từ Kho
                                </button>
                                {currentMoves.length > 0 && (
                                    <div className="flex flex-wrap justify-center gap-1">
                                        {orderedCurrentMoves.map((moveName, index) => (
                                            (() => {
                                                const isProtectedMove = isProtectedMoveName(moveName)
                                                return (
                                                    <button
                                                        key={`${moveName}-${index}-remove`}
                                                        type="button"
                                                        onClick={() => handleRemoveSkill(moveName)}
                                                        disabled={removingSkillName === moveName || isProtectedMove}
                                                        className={`px-2 py-1 text-[11px] font-bold rounded border ${isProtectedMove
                                                            ? 'bg-slate-100 border-slate-300 text-slate-500 cursor-not-allowed'
                                                            : 'bg-white border-red-300 text-red-700 hover:bg-red-50'} disabled:opacity-60 disabled:cursor-not-allowed`}
                                                        title={isProtectedMove ? 'Kỹ năng mặc định không thể gỡ' : ''}
                                                    >
                                                        {isProtectedMove
                                                            ? `${moveName} (mặc định)`
                                                            : (removingSkillName === moveName ? 'Đang gỡ...' : `Gỡ ${moveName}`)}
                                                    </button>
                                                )
                                            })()
                                        ))}
                                        {virtualDefaultMoveName && (
                                            <button
                                                type="button"
                                                disabled
                                                className="px-2 py-1 text-[11px] font-bold rounded border bg-slate-100 border-slate-300 text-slate-500 cursor-not-allowed"
                                                title="Kỹ năng mặc định luôn được giữ lại"
                                            >
                                                {virtualDefaultMoveName} (mặc định)
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
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
                                {originalTrainerDisplay}
                            </div>
                            <div className="w-1/2 p-2">
                                {obtainedLabel}
                            </div>
                        </div>
                    </div>

                </div>
            </div>
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

            <div className="mt-4 border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white text-center">
                <div className="bg-blue-100/50 p-1 font-bold text-blue-800 text-xs border-b border-blue-200 uppercase">
                    Xếp Hạng Theo Loài
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-white">
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Bạn có</div>
                        <div className="mt-1 text-2xl font-extrabold text-emerald-700">{viewerSpeciesOwnedCount.toLocaleString('vi-VN')}</div>
                        <div className="text-[11px] text-slate-500">Pokemon cùng loài này</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Server có</div>
                        <div className="mt-1 text-2xl font-extrabold text-blue-800">{speciesTotal.toLocaleString('vi-VN')}</div>
                        <div className="text-[11px] text-slate-500">Bản thể cùng loài trên server</div>
                    </div>
                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Hạng loài</div>
                        <div className="mt-1 text-2xl font-extrabold text-rose-700">{Number.isFinite(speciesRank) && speciesRank > 0 ? `#${speciesRank}` : '--'}</div>
                        <div className="text-[11px] text-slate-500">Theo độ hiếm sở hữu toàn server</div>
                    </div>
                </div>
            </div>

            <div className="mt-4 text-center text-xs font-bold text-blue-800 space-x-4">
                <Link to="/rankings/pokemon" className="hover:underline hover:text-red-500">Bảng Xếp Hạng Pokémon</Link>
                <a href="#pokemon-history" className="hover:underline hover:text-red-500">
                    Lịch Sử Pokémon
                </a>
            </div>

            <div id="pokemon-history" className="mt-4 border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                <div className="bg-blue-100/50 p-1 font-bold text-blue-800 text-xs border-b border-blue-200 uppercase text-center">
                    Lịch Sử Pokémon
                </div>
                <div className="p-3 space-y-2">
                    {historyEvents.length > 0 ? historyEvents.map((entry) => (
                        <div key={entry.id} className="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-bold text-slate-800">{entry.title}</div>
                                    <div className="mt-1 text-xs text-slate-600">{entry.description}</div>
                                </div>
                                <div className="shrink-0 text-[11px] font-semibold text-slate-500 text-right">
                                    {new Date(entry.occurredAt).toLocaleString('vi-VN')}
                                </div>
                            </div>
                        </div>
                    )) : (
                        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm italic text-slate-500">
                            Chưa có lịch sử hiển thị cho Pokémon này.
                        </div>
                    )}
                </div>
            </div>

            {levelTransferModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/70 p-4 flex items-center justify-center" onClick={() => setLevelTransferModalOpen(false)}>
                    <div className="w-full max-w-2xl bg-white border border-fuchsia-300 rounded-lg shadow-xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
                        <div className="bg-gradient-to-t from-fuchsia-600 to-pink-500 px-4 py-2 flex items-center justify-between border-b border-fuchsia-600">
                            <h3 className="text-sm sm:text-base font-bold text-white uppercase">Chọn Pokemon</h3>
                            <button
                                type="button"
                                onClick={() => setLevelTransferModalOpen(false)}
                                className="text-white text-xs font-bold px-2 py-1 rounded hover:bg-white/20"
                            >
                                Đóng
                            </button>
                        </div>

                        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-1.5">Tìm Pokemon</label>
                                <input
                                    type="text"
                                    value={levelTransferSearchTerm}
                                    onChange={(event) => {
                                        setLevelTransferSearchTerm(event.target.value)
                                        setLevelTransferPage(1)
                                    }}
                                    placeholder="Nhập tên hoặc biệt danh Pokemon"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm"
                                />
                            </div>

                            <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                                {levelTransferCandidatesLoading ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Đang tải Pokemon...</div>
                                ) : levelTransferCandidates.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không có Pokemon phù hợp. Pokemon cần từ Lv. 2 trở lên.</div>
                                ) : (
                                    levelTransferCandidates.map((entry) => {
                                        const sourceId = String(entry?._id || '')
                                        const isSelected = sourceId === selectedLevelTransferSourceId
                                        const sourceName = String(entry?.nickname || entry?.pokemon?.name || 'Pokemon').trim() || 'Pokemon'
                                        const sourceSpeciesName = String(entry?.pokemon?.name || 'Không rõ').trim() || 'Không rõ'
                                        const transferableLevels = Math.max(0, Number(entry?.level || 1) - 1)
                                        const sourceSprite = resolvePokemonDisplaySprite(entry?.pokemon, entry?.formId, entry?.isShiny)

                                        return (
                                            <button
                                                key={sourceId}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedLevelTransferSourceId(sourceId)
                                                    setSelectedLevelTransferSourceEntry(entry)
                                                    setLevelTransferModalOpen(false)
                                                }}
                                                className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${isSelected ? 'bg-fuchsia-50' : 'hover:bg-slate-50'}`}
                                            >
                                                <div className="w-10 h-10 flex-shrink-0 rounded border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                    <img src={sourceSprite} alt={sourceName} className="w-8 h-8 object-contain pixelated" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="font-semibold text-slate-700 truncate">{sourceName}</span>
                                                        <span className="text-xs text-slate-500">Lv.{entry.level}</span>
                                                    </div>
                                                    <div className="text-xs text-slate-500 truncate mt-0.5">
                                                        {sourceSpeciesName} • Chuyển {transferableLevels} cấp • {entry.location === 'party' ? 'Trong đội hình' : 'Trong kho'}
                                                    </div>
                                                </div>
                                            </button>
                                        )
                                    })
                                )}
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>Hiển thị {levelTransferStart}-{levelTransferEnd} / {levelTransferTotal} Pokemon</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setLevelTransferPage((prev) => Math.max(1, prev - 1))}
                                        disabled={levelTransferCurrentPage <= 1}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Trước
                                    </button>
                                    <span className="font-semibold text-slate-600">Trang {levelTransferCurrentPage}/{levelTransferTotalPages}</span>
                                    <button
                                        type="button"
                                        onClick={() => setLevelTransferPage((prev) => Math.min(levelTransferTotalPages, prev + 1))}
                                        disabled={levelTransferCurrentPage >= levelTransferTotalPages}
                                        className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        Sau
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
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
                                    {hasOffTypeSkillAccess && (
                                        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                            Pokemon này còn {offTypeSkillAllowance} lượt học skill khác hệ.
                                        </div>
                                    )}
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
                                                            {entry.canLearn && entry.usesOffTypeAllowance && (
                                                                <div className="text-[11px] text-fuchsia-700 font-semibold mt-1">Học kỹ năng này sẽ tốn 1 lượt skill khác hệ.</div>
                                                            )}
                                                            {!entry.canLearn && (
                                                                <div className="text-[11px] text-amber-700 font-semibold mt-1">{entry.reason || 'Không thể học kỹ năng này'}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </label>
                                            )
                                        })}
                                    </div>

                                    <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                                        Kỹ năng mặc định: <span className="font-bold text-slate-700">{virtualDefaultMoveName || 'Đã có trong bộ kỹ năng hiện tại'}</span>
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

            <BulkItemUseModal
                isOpen={growthItemModalOpen}
                onClose={() => setGrowthItemModalOpen(false)}
                item={selectedGrowthItem}
                inventoryQuantity={Number(selectedGrowthItem?.quantity || 0)}
                vipTierLevel={currentVipTierLevel}
                submitting={usingGrowthItem}
                onConfirm={handleUseGrowthItem}
                title="Dùng vật phẩm tăng trưởng"
                extraContent={selectedGrowthItem && pokemon ? (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                        Áp dụng cho <span className="font-bold">{String(pokemon?.nickname || pokemon?.pokemonId?.name || 'Pokemon').trim() || 'Pokemon'}</span>.
                    </div>
                ) : null}
                renderPreview={(item, quantity) => {
                    if (!item || !pokemon) return ''
                    const targetName = String(pokemon?.nickname || pokemon?.pokemonId?.name || 'Pokemon').trim() || 'Pokemon'
                    if (item.effectType === 'grantPokemonLevel') {
                        return `${targetName} sẽ nhận tối đa ${formatNumber(Number(item.effectValue || 0) * quantity)} cấp.`
                    }
                    return `${targetName} sẽ nhận ${formatNumber(Number(item.effectValue || 0) * quantity)} EXP.`
                }}
            />

        </div>
    )
}
