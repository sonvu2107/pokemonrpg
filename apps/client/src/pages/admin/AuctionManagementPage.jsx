import { useEffect, useMemo, useState } from 'react'
import { auctionAdminApi, itemApi, userApi } from '../../services/adminApi'
import { useToast } from '../../context/ToastContext'
import VipUsername from '../../components/VipUsername'
import { resolveImageSrc } from '../../utils/imageUrl'

const STATUS_OPTIONS = [
    { value: 'all', label: 'Tất cả trạng thái' },
    { value: 'draft', label: 'Nháp' },
    { value: 'scheduled', label: 'Đã lên lịch' },
    { value: 'active', label: 'Đang diễn ra' },
    { value: 'completed', label: 'Đã hoàn tất' },
    { value: 'cancelled', label: 'Đã hủy' },
    { value: 'settlement_failed', label: 'Chốt lỗi' },
]

const createInitialForm = () => ({
    id: '',
    title: '',
    description: '',
    rewardType: 'item',
    rewardItemId: '',
    rewardPokemonId: '',
    rewardPokemonFormId: 'normal',
    rewardPokemonLevel: 5,
    rewardPokemonIsShiny: false,
    rewardPokemonImageUrl: '',
    rewardPokemonName: '',
    rewardQuantity: 1,
    startingBid: 1000,
    minIncrement: 100,
    startsAt: '',
    endsAt: '',
    antiSnipingEnabled: true,
    antiSnipingWindowSeconds: 300,
    antiSnipingExtendSeconds: 300,
    antiSnipingMaxExtensions: 12,
})

const ITEM_PICKER_PAGE_SIZE = 12
const AUCTION_BID_PAGE_SIZE = 10
const POKEMON_PICKER_PAGE_SIZE = 24

const toDatetimeLocalValue = (value) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const tzOffset = date.getTimezoneOffset() * 60000
    return new Date(date.getTime() - tzOffset).toISOString().slice(0, 16)
}

const formatDateTime = (value) => {
    if (!value) return '--'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '--'
    return date.toLocaleString('vi-VN')
}

const getAuctionStatusLabel = (status) => {
    const normalizedStatus = String(status || '').trim().toLowerCase()
    return STATUS_OPTIONS.find((option) => option.value === normalizedStatus)?.label || normalizedStatus || '--'
}

const getSettlementStatusLabel = (status) => {
    const normalizedStatus = String(status || '').trim().toLowerCase()
    if (normalizedStatus === 'pending') return 'Chờ chốt'
    if (normalizedStatus === 'processing') return 'Đang chốt'
    if (normalizedStatus === 'success') return 'Chốt thành công'
    if (normalizedStatus === 'failed') return 'Chốt thất bại'
    return normalizedStatus || '--'
}

const getItemTypeLabel = (type) => {
    const normalizedType = String(type || '').trim().toLowerCase()
    if (normalizedType === 'healing') return 'Hồi phục'
    if (normalizedType === 'pokeball') return 'Bóng'
    if (normalizedType === 'evolution') return 'Tiến hóa'
    if (normalizedType === 'battle') return 'Chiến đấu'
    if (normalizedType === 'key') return 'Quan trọng'
    if (normalizedType === 'misc') return 'Khác'
    return normalizedType || '--'
}

const getItemRarityLabel = (rarity) => {
    const normalizedRarity = String(rarity || '').trim().toLowerCase()
    if (normalizedRarity === 'common') return 'Phổ biến'
    if (normalizedRarity === 'uncommon') return 'Không phổ biến'
    if (normalizedRarity === 'rare') return 'Hiếm'
    if (normalizedRarity === 'epic') return 'Sử thi'
    if (normalizedRarity === 'legendary') return 'Huyền thoại'
    return normalizedRarity || '--'
}

export default function AuctionManagementPage() {
    const toast = useToast()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [statusFilter, setStatusFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [searchInput, setSearchInput] = useState('')
    const [auctions, setAuctions] = useState([])
    const [selectedAuctionId, setSelectedAuctionId] = useState('')
    const [selectedAuction, setSelectedAuction] = useState(null)
    const [auctionBids, setAuctionBids] = useState([])
    const [auctionBidsLoading, setAuctionBidsLoading] = useState(false)
    const [auctionBidsPage, setAuctionBidsPage] = useState(1)
    const [auctionBidsPagination, setAuctionBidsPagination] = useState({ page: 1, totalPages: 1, total: 0, limit: AUCTION_BID_PAGE_SIZE })
    const [formData, setFormData] = useState(createInitialForm())
    const [itemOptions, setItemOptions] = useState([])
    const [itemPickerOpen, setItemPickerOpen] = useState(false)
    const [itemPickerSearch, setItemPickerSearch] = useState('')
    const [itemPickerPage, setItemPickerPage] = useState(1)
    const [formCollapsed, setFormCollapsed] = useState(false)
    const [pokemonPickerOpen, setPokemonPickerOpen] = useState(false)
    const [pokemonPickerSearch, setPokemonPickerSearch] = useState('')
    const [pokemonPickerPage, setPokemonPickerPage] = useState(1)
    const [pokemonPickerTotalPages, setPokemonPickerTotalPages] = useState(1)
    const [pokemonOptions, setPokemonOptions] = useState([])
    const [pokemonLoading, setPokemonLoading] = useState(false)

    const selectedRewardItem = useMemo(() => (
        itemOptions.find((item) => String(item?._id || '') === String(formData.rewardItemId || '')) || null
    ), [formData.rewardItemId, itemOptions])
    const selectedRewardPokemon = useMemo(() => (
        pokemonOptions.find((pokemon) => String(pokemon?._id || '') === String(formData.rewardPokemonId || '')) || null
    ), [formData.rewardPokemonId, pokemonOptions])

    const filteredItemOptions = useMemo(() => {
        const normalizedSearch = String(itemPickerSearch || '').trim().toLowerCase()
        if (!normalizedSearch) return itemOptions
        return itemOptions.filter((item) => {
            const name = String(item?.name || '').toLowerCase()
            const rarity = String(item?.rarity || '').toLowerCase()
            const type = String(item?.type || '').toLowerCase()
            return name.includes(normalizedSearch) || rarity.includes(normalizedSearch) || type.includes(normalizedSearch)
        })
    }, [itemOptions, itemPickerSearch])
    const itemPickerTotalPages = Math.max(1, Math.ceil(filteredItemOptions.length / ITEM_PICKER_PAGE_SIZE))
    const normalizedItemPickerPage = Math.min(itemPickerPage, itemPickerTotalPages)
    const paginatedItemOptions = filteredItemOptions.slice(
        (normalizedItemPickerPage - 1) * ITEM_PICKER_PAGE_SIZE,
        normalizedItemPickerPage * ITEM_PICKER_PAGE_SIZE
    )
    const selectedPokemonForms = useMemo(() => {
        if (Array.isArray(selectedRewardPokemon?.forms) && selectedRewardPokemon.forms.length > 0) {
            return selectedRewardPokemon.forms
        }
        return [{ formId: 'normal', formName: 'normal' }]
    }, [selectedRewardPokemon])

    const loadItems = async () => {
        try {
            const data = await itemApi.list({ search: '', page: 1, limit: 100 })
            setItemOptions(Array.isArray(data?.items) ? data.items : [])
        } catch (err) {
            toast.showError(err.message || 'Không thể tải danh sách vật phẩm')
        }
    }

    const loadPokemonOptions = async (searchText = '', page = 1) => {
        try {
            setPokemonLoading(true)
            const data = await userApi.lookupPokemon({ search: searchText, page, limit: POKEMON_PICKER_PAGE_SIZE })
            const rows = Array.isArray(data?.pokemon) ? data.pokemon : []
            setPokemonOptions(rows)
            setPokemonPickerTotalPages(Math.max(1, Number(data?.pagination?.pages || 1)))
        } catch (err) {
            toast.showError(err.message || 'Không thể tải danh sách Pokemon')
            setPokemonOptions([])
            setPokemonPickerTotalPages(1)
        } finally {
            setPokemonLoading(false)
        }
    }

    const loadAuctions = async () => {
        try {
            setLoading(true)
            const data = await auctionAdminApi.list({ status: statusFilter, search, limit: 50 })
            const rows = Array.isArray(data?.auctions) ? data.auctions : []
            setAuctions(rows)
            if (rows.length > 0) {
                setSelectedAuctionId((prev) => prev && rows.some((entry) => entry.id === prev) ? prev : rows[0].id)
            } else {
                setSelectedAuctionId('')
                setSelectedAuction(null)
                setAuctionBids([])
                setAuctionBidsPagination({ page: 1, totalPages: 1, total: 0, limit: AUCTION_BID_PAGE_SIZE })
            }
        } catch (err) {
            toast.showError(err.message || 'Không thể tải danh sách đấu giá admin')
            setAuctions([])
        } finally {
            setLoading(false)
        }
    }

    const loadAuctionDetail = async (auctionId) => {
        if (!auctionId) {
            setSelectedAuction(null)
            return
        }
        try {
            const data = await auctionAdminApi.getById(auctionId)
            setSelectedAuction(data?.auction || null)
        } catch (err) {
            toast.showError(err.message || 'Không thể tải chi tiết đấu giá')
        }
    }

    const loadAuctionBidPage = async (auctionId, page = 1) => {
        if (!auctionId) {
            setAuctionBids([])
            return
        }
        try {
            setAuctionBidsLoading(true)
            const data = await auctionAdminApi.getBids(auctionId, { page, limit: AUCTION_BID_PAGE_SIZE })
            setAuctionBids(Array.isArray(data?.bids) ? data.bids : [])
            setAuctionBidsPagination(data?.pagination || { page: 1, totalPages: 1, total: 0, limit: AUCTION_BID_PAGE_SIZE })
        } catch (err) {
            toast.showError(err.message || 'Không thể tải lịch sử giá đấu admin')
        } finally {
            setAuctionBidsLoading(false)
        }
    }

    const refreshAuctionData = async () => {
        await loadAuctions()
        if (selectedAuctionId) {
            await Promise.all([
                loadAuctionDetail(selectedAuctionId),
                loadAuctionBidPage(selectedAuctionId, auctionBidsPage),
            ])
        }
    }

    useEffect(() => {
        loadItems()
    }, [])

    useEffect(() => {
        loadAuctions()
    }, [statusFilter, search])

    useEffect(() => {
        if (selectedAuctionId) {
            loadAuctionDetail(selectedAuctionId)
        }
    }, [selectedAuctionId])

    useEffect(() => {
        if (!pokemonPickerOpen) return
        const timeout = setTimeout(() => {
            loadPokemonOptions(pokemonPickerSearch, pokemonPickerPage)
        }, 250)
        return () => clearTimeout(timeout)
    }, [pokemonPickerOpen, pokemonPickerSearch, pokemonPickerPage])

    useEffect(() => {
        if (!selectedAuctionId) return undefined
        const interval = setInterval(() => {
            loadAuctions()
            loadAuctionDetail(selectedAuctionId)
            loadAuctionBidPage(selectedAuctionId, auctionBidsPage)
        }, 15000)
        return () => clearInterval(interval)
    }, [selectedAuctionId, auctionBidsPage])

    useEffect(() => {
        if (!selectedAuctionId) return
        loadAuctionBidPage(selectedAuctionId, auctionBidsPage)
    }, [selectedAuctionId, auctionBidsPage])

    useEffect(() => {
        setAuctionBidsPage(1)
    }, [selectedAuctionId])

    const resetForm = () => {
        setFormData(createInitialForm())
        setItemPickerSearch('')
        setItemPickerPage(1)
        setPokemonPickerSearch('')
        setPokemonPickerPage(1)
    }

    const handleEditDraft = () => {
        if (!selectedAuction || selectedAuction.status !== 'draft') {
            toast.showWarning('Chỉ có thể nạp dữ liệu từ phiên nháp để chỉnh sửa')
            return
        }
        setFormData({
            id: selectedAuction.id,
            title: selectedAuction.title || '',
            description: selectedAuction.description || '',
            rewardType: selectedAuction.rewardType || 'item',
            rewardItemId: selectedAuction.rewardSnapshot?.itemId || '',
            rewardPokemonId: selectedAuction.rewardSnapshot?.pokemonId || '',
            rewardPokemonFormId: selectedAuction.rewardSnapshot?.formId || 'normal',
            rewardPokemonLevel: selectedAuction.rewardSnapshot?.level || 5,
            rewardPokemonIsShiny: Boolean(selectedAuction.rewardSnapshot?.isShiny),
            rewardPokemonImageUrl: selectedAuction.rewardSnapshot?.imageUrl || '',
            rewardPokemonName: selectedAuction.rewardSnapshot?.name || '',
            rewardQuantity: selectedAuction.rewardSnapshot?.quantity || 1,
            startingBid: selectedAuction.startingBid || 1000,
            minIncrement: selectedAuction.minIncrement || 100,
            startsAt: toDatetimeLocalValue(selectedAuction.startsAt),
            endsAt: toDatetimeLocalValue(selectedAuction.endsAt),
            antiSnipingEnabled: selectedAuction.antiSnipingEnabled !== false,
            antiSnipingWindowSeconds: selectedAuction.antiSnipingWindowSeconds || 300,
            antiSnipingExtendSeconds: selectedAuction.antiSnipingExtendSeconds || 300,
            antiSnipingMaxExtensions: selectedAuction.antiSnipingMaxExtensions || 12,
        })
    }

    const handleSubmit = async () => {
        if (!formData.title.trim()) return toast.showWarning('Vui lòng nhập tiêu đề')
        if (formData.rewardType === 'item' && !formData.rewardItemId) return toast.showWarning('Vui lòng chọn vật phẩm phần thưởng')
        if (formData.rewardType === 'pokemon' && !formData.rewardPokemonId) return toast.showWarning('Vui lòng chọn Pokemon phần thưởng')
        if (!formData.startsAt || !formData.endsAt) return toast.showWarning('Vui lòng nhập thời gian bắt đầu và kết thúc')

        try {
            setSaving(true)
            const payload = {
                title: formData.title.trim(),
                description: formData.description.trim(),
                rewardType: formData.rewardType,
                rewardItemId: formData.rewardItemId,
                rewardPokemonId: formData.rewardPokemonId,
                rewardPokemonFormId: formData.rewardPokemonFormId,
                rewardPokemonLevel: Math.max(1, Number.parseInt(formData.rewardPokemonLevel, 10) || 5),
                rewardPokemonIsShiny: Boolean(formData.rewardPokemonIsShiny),
                rewardPokemonImageUrl: formData.rewardPokemonImageUrl,
                rewardPokemonName: formData.rewardPokemonName,
                rewardQuantity: Math.max(1, Number.parseInt(formData.rewardQuantity, 10) || 1),
                startingBid: Math.max(1, Number.parseInt(formData.startingBid, 10) || 1),
                minIncrement: Math.max(1, Number.parseInt(formData.minIncrement, 10) || 1),
                startsAt: new Date(formData.startsAt).toISOString(),
                endsAt: new Date(formData.endsAt).toISOString(),
                antiSnipingEnabled: Boolean(formData.antiSnipingEnabled),
                antiSnipingWindowSeconds: Math.max(0, Number.parseInt(formData.antiSnipingWindowSeconds, 10) || 0),
                antiSnipingExtendSeconds: Math.max(0, Number.parseInt(formData.antiSnipingExtendSeconds, 10) || 0),
                antiSnipingMaxExtensions: Math.max(0, Number.parseInt(formData.antiSnipingMaxExtensions, 10) || 0),
            }
            const result = formData.id
                ? await auctionAdminApi.update(formData.id, payload)
                : await auctionAdminApi.create(payload)
            toast.showSuccess(result?.message || 'Lưu phiên đấu giá thành công')
            resetForm()
            await loadAuctions()
        } catch (err) {
            toast.showError(err.message || 'Lưu phiên đấu giá thất bại')
        } finally {
            setSaving(false)
        }
    }

    const handleChooseRewardItem = (itemId) => {
        setFormData((prev) => ({ ...prev, rewardType: 'item', rewardItemId: String(itemId || '').trim() }))
        setItemPickerOpen(false)
        setItemPickerSearch('')
        setItemPickerPage(1)
    }

    const handleChooseRewardPokemon = (pokemon, formEntry = null) => {
        setFormData((prev) => ({
            ...prev,
            rewardType: 'pokemon',
            rewardPokemonId: String(pokemon?._id || '').trim(),
            rewardPokemonFormId: String(formEntry?.formId || pokemon?.defaultFormId || 'normal').trim().toLowerCase() || 'normal',
            rewardPokemonImageUrl: String(formEntry?.imageUrl || pokemon?.sprite || pokemon?.imageUrl || '').trim(),
            rewardPokemonName: String(pokemon?.name || 'Pokemon').trim() || 'Pokemon',
        }))
        setPokemonPickerOpen(false)
        setPokemonPickerSearch('')
        setPokemonPickerPage(1)
    }

    const handlePublish = async () => {
        if (!selectedAuctionId) return
        try {
            const result = await auctionAdminApi.publish(selectedAuctionId)
            toast.showSuccess(result?.message || 'Đã publish phiên đấu giá')
            await Promise.all([loadAuctions(), loadAuctionDetail(selectedAuctionId), loadAuctionBidPage(selectedAuctionId, auctionBidsPage)])
        } catch (err) {
            toast.showError(err.message || 'Publish phiên đấu giá thất bại')
        }
    }

    const handleCancel = async () => {
        if (!selectedAuctionId) return
        const cancelReason = prompt('Lý do hủy phiên đấu giá (không bắt buộc):', '') || ''
        try {
            const result = await auctionAdminApi.cancel(selectedAuctionId, { cancelReason })
            toast.showSuccess(result?.message || 'Đã hủy phiên đấu giá')
            await Promise.all([loadAuctions(), loadAuctionDetail(selectedAuctionId), loadAuctionBidPage(selectedAuctionId, auctionBidsPage)])
        } catch (err) {
            toast.showError(err.message || 'Hủy phiên đấu giá thất bại')
        }
    }

    const handleSettle = async () => {
        if (!selectedAuctionId) return
        try {
            const result = await auctionAdminApi.settle(selectedAuctionId)
            toast.showSuccess(result?.message || 'Đã chốt phiên đấu giá')
            await Promise.all([loadAuctions(), loadAuctionDetail(selectedAuctionId), loadAuctionBidPage(selectedAuctionId, auctionBidsPage)])
        } catch (err) {
            toast.showError(err.message || 'Chốt phiên đấu giá thất bại')
        }
    }

    return (
        <div className="max-w-7xl mx-auto space-y-4">
            <div className="rounded-xl border border-blue-300 bg-white shadow-sm overflow-hidden">
                <div className="bg-gradient-to-t from-blue-600 to-cyan-500 px-4 py-2 flex items-center justify-between gap-3 text-white font-bold uppercase tracking-wide">
                    <span>Quản lý đấu giá</span>
                    <button
                        type="button"
                        onClick={() => setFormCollapsed((prev) => !prev)}
                        className="rounded border border-white/40 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-white/20"
                    >
                        {formCollapsed ? 'Mở rộng' : 'Thu gọn'}
                    </button>
                </div>
                {!formCollapsed && (
                    <div className="p-4 space-y-4">
                        <div className="space-y-1">
                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Loại phần thưởng</label>
                            <div className="grid grid-cols-2 gap-2 md:max-w-sm">
                                <button type="button" onClick={() => setFormData((prev) => ({ ...prev, rewardType: 'item' }))} className={`rounded border px-3 py-2 text-sm font-bold ${formData.rewardType === 'item' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>Vật phẩm</button>
                                <button type="button" onClick={() => setFormData((prev) => ({ ...prev, rewardType: 'pokemon' }))} className={`rounded border px-3 py-2 text-sm font-bold ${formData.rewardType === 'pokemon' ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>Pokemon</button>
                            </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                                <div className="space-y-1 lg:col-span-4">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Tiêu đề đấu giá</label>
                                    <input type="text" value={formData.title} onChange={(event) => setFormData((prev) => ({ ...prev, title: event.target.value }))} placeholder="Nhập tiêu đề đấu giá" className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 bg-white" />
                                </div>
                                <div className="space-y-1 lg:col-span-8">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">{formData.rewardType === 'pokemon' ? 'Pokemon phần thưởng' : 'Vật phẩm phần thưởng'}</label>
                                    {formData.rewardType === 'pokemon' ? (
                                        <button type="button" onClick={() => {
                                            setPokemonPickerOpen(true)
                                            setPokemonPickerPage(1)
                                            if (pokemonOptions.length === 0) loadPokemonOptions('', 1)
                                        }} className="flex w-full items-center justify-between rounded border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                                            <span className="truncate">{formData.rewardPokemonName ? `${formData.rewardPokemonName} (${formData.rewardPokemonFormId})` : 'Chọn Pokemon phần thưởng'}</span>
                                            <span className="text-xs font-bold text-blue-700">Mở danh sách</span>
                                        </button>
                                    ) : (
                                        <button type="button" onClick={() => {
                                            setItemPickerOpen(true)
                                            setItemPickerPage(1)
                                        }} className="flex w-full items-center justify-between rounded border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                                            <span className="truncate">{selectedRewardItem ? `${selectedRewardItem.name} (${getItemRarityLabel(selectedRewardItem.rarity)})` : 'Chọn vật phẩm phần thưởng'}</span>
                                            <span className="text-xs font-bold text-blue-700">Mở danh sách</span>
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                <div className="space-y-1">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Số lượng thưởng</label>
                                    <input type="number" min="1" value={formData.rewardQuantity} onChange={(event) => setFormData((prev) => ({ ...prev, rewardQuantity: event.target.value }))} placeholder="1" className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 bg-white" />
                                </div>
                                <div className="space-y-1">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Giá khởi điểm</label>
                                    <input type="number" min="1" value={formData.startingBid} onChange={(event) => setFormData((prev) => ({ ...prev, startingBid: event.target.value }))} placeholder="1000" className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 bg-white" />
                                </div>
                                <div className="space-y-1">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Bước giá tối thiểu</label>
                                    <input type="number" min="1" value={formData.minIncrement} onChange={(event) => setFormData((prev) => ({ ...prev, minIncrement: event.target.value }))} placeholder="100" className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 bg-white" />
                                </div>
                                <div className="space-y-1">
                                    <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Chống trả giá phút cuối</label>
                                    <label className="inline-flex min-h-[42px] w-full items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 leading-snug">
                                        <input type="checkbox" checked={formData.antiSnipingEnabled} onChange={(event) => setFormData((prev) => ({ ...prev, antiSnipingEnabled: event.target.checked }))} className="accent-blue-600" />
                                        Bật gia hạn khi có người trả giá sát giờ
                                    </label>
                                </div>
                            </div>

                            {formData.rewardType === 'pokemon' && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="space-y-1">
                                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Form Pokemon</label>
                                        <select value={formData.rewardPokemonFormId} onChange={(event) => setFormData((prev) => ({ ...prev, rewardPokemonFormId: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 bg-white">
                                            {selectedPokemonForms.map((formEntry) => (
                                                <option key={String(formEntry?.formId || 'normal')} value={String(formEntry?.formId || 'normal')}>
                                                    {formEntry?.formName || formEntry?.formId || 'normal'}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Cấp Pokemon</label>
                                        <input type="number" min="1" value={formData.rewardPokemonLevel} onChange={(event) => setFormData((prev) => ({ ...prev, rewardPokemonLevel: event.target.value }))} placeholder="5" className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 bg-white" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Biến thể</label>
                                        <label className="inline-flex min-h-[42px] w-full items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                                            <input type="checkbox" checked={formData.rewardPokemonIsShiny} onChange={(event) => setFormData((prev) => ({ ...prev, rewardPokemonIsShiny: event.target.checked }))} className="accent-amber-500" />
                                            Pokemon Shiny
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="space-y-1">
                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Mô tả đấu giá</label>
                            <textarea value={formData.description} onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))} rows={3} placeholder="Nhập mô tả ngắn cho phiên đấu giá" className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                            <div className="space-y-1">
                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Cửa sổ gia hạn (giây)</label>
                                <input type="number" min="0" value={formData.antiSnipingWindowSeconds} onChange={(event) => setFormData((prev) => ({ ...prev, antiSnipingWindowSeconds: event.target.value }))} placeholder="300" className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700" />
                            </div>
                            <div className="space-y-1">
                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Thời gian cộng thêm (giây)</label>
                                <input type="number" min="0" value={formData.antiSnipingExtendSeconds} onChange={(event) => setFormData((prev) => ({ ...prev, antiSnipingExtendSeconds: event.target.value }))} placeholder="300" className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700" />
                            </div>
                            <div className="space-y-1">
                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Số lần gia hạn tối đa</label>
                                <input type="number" min="0" value={formData.antiSnipingMaxExtensions} onChange={(event) => setFormData((prev) => ({ ...prev, antiSnipingMaxExtensions: event.target.value }))} placeholder="12" className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700" />
                            </div>
                            <div className="space-y-1 xl:col-span-1">
                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Thời gian bắt đầu</label>
                                <input type="datetime-local" value={formData.startsAt} onChange={(event) => setFormData((prev) => ({ ...prev, startsAt: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700" />
                            </div>
                            <div className="space-y-1 xl:col-span-1">
                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Thời gian kết thúc</label>
                                <input type="datetime-local" value={formData.endsAt} onChange={(event) => setFormData((prev) => ({ ...prev, endsAt: event.target.value }))} className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700" />
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={handleSubmit} disabled={saving} className="rounded border border-blue-300 bg-white px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50">{saving ? 'Đang lưu...' : (formData.id ? 'Cập nhật nháp' : 'Tạo phiên nháp')}</button>
                            <button type="button" onClick={resetForm} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Tạo mẫu mới</button>
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
                        <div className="text-sm font-bold text-slate-700">Danh sách phiên đấu giá</div>
                        <div className="flex flex-col gap-2">
                            <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">Lọc theo trạng thái</label>
                            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700">
                                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                            <div className="flex gap-2">
                                <input type="text" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Tìm theo mã hoặc tiêu đề" className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm text-slate-700" />
                                <button type="button" onClick={() => setSearch(searchInput.trim())} className="rounded border border-blue-300 bg-white px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50">Tìm</button>
                            </div>
                        </div>
                    </div>
                    <div className="max-h-[40vh] overflow-y-auto divide-y divide-slate-100">
                        {loading ? <div className="px-4 py-8 text-center text-slate-500">Đang tải...</div> : auctions.length === 0 ? <div className="px-4 py-8 text-center text-slate-500">Chưa có phiên đấu giá.</div> : auctions.map((auction) => (
                            <button key={auction.id} type="button" onClick={() => setSelectedAuctionId(auction.id)} className={`w-full px-4 py-3 text-left hover:bg-blue-50 ${selectedAuctionId === auction.id ? 'bg-blue-50' : ''}`}>
                                <div className="text-xs font-bold uppercase tracking-wide text-blue-700">{auction.code}</div>
                                <div className="font-bold text-slate-800 line-clamp-2">{auction.title}</div>
                                <div className="text-xs text-slate-500">Người tham gia: {Number(auction.participantCount || 0).toLocaleString('vi-VN')}</div>
                                <div className="text-xs text-slate-500">{getAuctionStatusLabel(auction.status)} - Kết thúc: {formatDateTime(auction.endsAt)}</div>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap gap-2 items-center justify-between">
                        <div className="text-sm font-bold text-slate-700">Chi tiết</div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={refreshAuctionData} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">Làm mới</button>
                            <button type="button" onClick={handleEditDraft} disabled={!selectedAuction || selectedAuction.status !== 'draft'} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Nạp vào mẫu</button>
                            <button type="button" onClick={handlePublish} disabled={!selectedAuction || selectedAuction.status !== 'draft'} className="rounded border border-blue-300 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50">Xuất bản</button>
                            <button type="button" onClick={handleSettle} disabled={!selectedAuction || !['active', 'settlement_failed'].includes(selectedAuction.status)} className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Chốt tay</button>
                            <button type="button" onClick={handleCancel} disabled={!selectedAuction || ['completed', 'cancelled'].includes(selectedAuction.status)} className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">Hủy phiên</button>
                        </div>
                    </div>
                    {!selectedAuction ? (
                        <div className="px-4 py-8 text-center text-slate-500">Chọn một phiên đấu giá để xem chi tiết.</div>
                    ) : (
                        <div className="p-4 space-y-4">
                            <div className="flex flex-col md:flex-row gap-4">
                                <div className="w-24 h-24 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                                    {selectedAuction.rewardSnapshot?.imageUrl ? <img src={resolveImageSrc(selectedAuction.rewardSnapshot.imageUrl)} alt={selectedAuction.rewardSnapshot?.name} className="w-16 h-16 object-contain" /> : <span className="text-slate-300">?</span>}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-1 text-sm">
                                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold">Tiêu đề:</span> {selectedAuction.title}</div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold">Trạng thái:</span> {getAuctionStatusLabel(selectedAuction.status)}</div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold">Phần thưởng:</span> {selectedAuction.rewardSnapshot?.name} x{selectedAuction.rewardSnapshot?.quantity || 1}</div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold">Giá cao nhất:</span> {Number(selectedAuction.highestBid || 0).toLocaleString('vi-VN')} Xu</div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold">Người tham gia:</span> {Number(selectedAuction.participantCount || 0).toLocaleString('vi-VN')}</div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold">Bắt đầu:</span> {formatDateTime(selectedAuction.startsAt)}</div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-bold">Kết thúc:</span> {formatDateTime(selectedAuction.endsAt)}</div>
                                    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 md:col-span-2"><span className="font-bold">Trạng thái chốt phiên:</span> {getSettlementStatusLabel(selectedAuction.settlementStatus)}{selectedAuction.settlementError ? ` - ${selectedAuction.settlementError}` : ''}</div>
                                </div>
                            </div>
                            <div className="rounded border border-slate-200 p-4 bg-white">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <div className="text-sm font-bold text-slate-700">Lịch sử giá gần nhất</div>
                                    <div className="text-xs font-semibold text-slate-500">Trang {auctionBidsPagination.page || 1}/{auctionBidsPagination.totalPages || 1}</div>
                                </div>
                                <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {auctionBidsLoading ? <div className="text-sm text-slate-500">Đang tải lịch sử giá...</div> : auctionBids.length === 0 ? <div className="text-sm text-slate-500">Chưa có ai đặt giá.</div> : auctionBids.map((bid) => (
                                        <div key={bid.id} className="rounded border border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between gap-3 text-sm">
                                            <div>
                                                <VipUsername userLike={bid} className="font-bold text-slate-800">{bid.username}</VipUsername>
                                                <div className="text-xs text-slate-500">{formatDateTime(bid.createdAt)}</div>
                                            </div>
                                            <div className="font-bold text-blue-700">{Number(bid.amount || 0).toLocaleString('vi-VN')} Xu</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
                                    <div className="text-xs text-slate-500">Tổng lượt trả giá: {Number(auctionBidsPagination.total || 0).toLocaleString('vi-VN')}</div>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => setAuctionBidsPage((prev) => Math.max(1, prev - 1))} disabled={(auctionBidsPagination.page || 1) <= 1 || auctionBidsLoading} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Trang trước</button>
                                        <button type="button" onClick={() => setAuctionBidsPage((prev) => Math.min(auctionBidsPagination.totalPages || 1, prev + 1))} disabled={(auctionBidsPagination.page || 1) >= (auctionBidsPagination.totalPages || 1) || auctionBidsLoading} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Trang sau</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            </div>

            {itemPickerOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
                    <div className="w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                            <div>
                                <div className="text-lg font-bold text-slate-800">Chọn vật phẩm phần thưởng</div>
                                <div className="text-sm text-slate-500">Chỉ cần chọn 1 vật phẩm để snapshot vào phiên đấu giá.</div>
                            </div>
                            <button type="button" onClick={() => setItemPickerOpen(false)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50">Đóng</button>
                        </div>
                        <div className="p-4 space-y-4">
                            <input
                                type="text"
                                value={itemPickerSearch}
                                onChange={(event) => {
                                    setItemPickerSearch(event.target.value)
                                    setItemPickerPage(1)
                                }}
                                placeholder="Tìm theo tên, loại hoặc độ hiếm vật phẩm"
                                className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
                            />
                            <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200">
                                {filteredItemOptions.length === 0 ? (
                                    <div className="px-4 py-10 text-center text-sm text-slate-500">Không tìm thấy vật phẩm phù hợp.</div>
                                ) : (
                                    <div className="space-y-3 p-3">
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                            {paginatedItemOptions.map((item) => (
                                                <button
                                                    key={item._id}
                                                    type="button"
                                                    onClick={() => handleChooseRewardItem(item._id)}
                                                    className={`rounded-xl border p-3 text-left transition ${String(formData.rewardItemId || '') === String(item._id || '') ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50'}`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 overflow-hidden shrink-0">
                                                            {item.imageUrl ? <img src={resolveImageSrc(item.imageUrl)} alt={item.name} className="h-10 w-10 object-contain" /> : <span className="text-slate-300">?</span>}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-bold text-slate-800 truncate">{item.name}</div>
                                                            <div className="text-xs text-slate-500">Loại: {getItemTypeLabel(item.type)}</div>
                                                            <div className="text-xs text-slate-500">Độ hiếm: {getItemRarityLabel(item.rarity)}</div>
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                        {itemPickerTotalPages > 1 && (
                                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                                <div className="text-xs font-semibold text-slate-500">
                                                    Trang {normalizedItemPickerPage}/{itemPickerTotalPages} - {filteredItemOptions.length.toLocaleString('vi-VN')} vật phẩm
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setItemPickerPage((prev) => Math.max(1, prev - 1))}
                                                        disabled={normalizedItemPickerPage <= 1}
                                                        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                                    >
                                                        Trang trước
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setItemPickerPage((prev) => Math.min(itemPickerTotalPages, prev + 1))}
                                                        disabled={normalizedItemPickerPage >= itemPickerTotalPages}
                                                        className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                                    >
                                                        Trang sau
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {pokemonPickerOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
                    <div className="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
                        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                            <div>
                                <div className="text-lg font-bold text-slate-800">Chọn Pokemon phần thưởng</div>
                                <div className="text-sm text-slate-500">Chọn Pokemon và form tương tự modal chọn vật phẩm.</div>
                            </div>
                            <button type="button" onClick={() => setPokemonPickerOpen(false)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50">Đóng</button>
                        </div>
                        <div className="p-4 space-y-4">
                            <input
                                type="text"
                                value={pokemonPickerSearch}
                                onChange={(event) => {
                                    setPokemonPickerSearch(event.target.value)
                                    setPokemonPickerPage(1)
                                }}
                                placeholder="Tìm theo tên Pokemon"
                                className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700"
                            />
                            <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 p-3">
                                {pokemonLoading ? (
                                    <div className="px-4 py-10 text-center text-sm text-slate-500">Đang tải danh sách Pokemon...</div>
                                ) : pokemonOptions.length === 0 ? (
                                    <div className="px-4 py-10 text-center text-sm text-slate-500">Không tìm thấy Pokemon phù hợp.</div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {pokemonOptions.map((pokemon) => {
                                            const forms = Array.isArray(pokemon?.forms) && pokemon.forms.length > 0
                                                ? pokemon.forms
                                                : [{ formId: pokemon?.defaultFormId || 'normal', formName: pokemon?.defaultFormId || 'normal' }]
                                            return (
                                                <button
                                                    key={pokemon._id}
                                                    type="button"
                                                    onClick={() => handleChooseRewardPokemon(pokemon, forms[0])}
                                                    className={`w-full rounded-xl border p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 ${String(formData.rewardPokemonId || '') === String(pokemon?._id || '') ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 overflow-hidden shrink-0">
                                                            {pokemon?.sprite ? <img src={resolveImageSrc(pokemon.sprite)} alt={pokemon.name} className="h-12 w-12 object-contain pixelated" /> : <span className="text-slate-300">?</span>}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-bold text-slate-800 truncate">{pokemon.name}</div>
                                                            <div className="text-xs text-slate-500 font-mono">#{String(pokemon?.pokedexNumber || 0).padStart(3, '0')}</div>
                                                            <div className="mt-1 flex flex-wrap gap-1">
                                                                {forms.slice(0, 4).map((formEntry) => (
                                                                    <span
                                                                        key={`${pokemon._id}-${formEntry.formId}`}
                                                                        className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                                                                    >
                                                                        {formEntry.formName || formEntry.formId}
                                                                    </span>
                                                                ))}
                                                                {forms.length > 4 && (
                                                                    <span className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                                                                        +{forms.length - 4} dạng
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                            {pokemonPickerTotalPages > 1 && (
                                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                    <div className="text-xs font-semibold text-slate-500">Trang {pokemonPickerPage}/{pokemonPickerTotalPages}</div>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => setPokemonPickerPage((prev) => Math.max(1, prev - 1))} disabled={pokemonPickerPage <= 1} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Trang trước</button>
                                        <button type="button" onClick={() => setPokemonPickerPage((prev) => Math.min(pokemonPickerTotalPages, prev + 1))} disabled={pokemonPickerPage >= pokemonPickerTotalPages} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">Trang sau</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
