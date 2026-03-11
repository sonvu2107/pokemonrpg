import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { promoCodeApi } from '../../services/adminApi'

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'
const DEFAULT_POKEMON_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const DEFAULT_ITEM_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'
const buildItemRewardRow = () => ({ itemId: '', quantity: 1 })

const sanitizeCodeToken = (value = '') => String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 30)

const buildAutoCode = (title = '') => {
    const normalizedTitle = String(title || '')
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9\s]/g, ' ')
        .trim()

    const titlePart = normalizedTitle
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join('_')
        .slice(0, 12)

    const now = new Date()
    const datePart = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase()

    const raw = [titlePart || 'GIFT', datePart, randomPart].filter(Boolean).join('_')
    return sanitizeCodeToken(raw)
}

const buildInitialForm = () => ({
    code: '',
    title: '',
    description: '',
    rewardType: 'bundle',
    amount: 1,
    platinumCoinsAmount: 0,
    moonPointsAmount: 0,
    itemRewards: [buildItemRewardRow()],
    pokemonId: '',
    pokemonQuantity: 0,
    formId: 'normal',
    pokemonLevel: 5,
    isShiny: false,
    perUserLimit: 1,
    maxTotalClaims: '',
    startsAt: '',
    endsAt: '',
    isActive: true,
})

const toDatetimeLocalValue = (value) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    const offsetMs = date.getTimezoneOffset() * 60000
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

const getPokemonForms = (pokemonLike) => {
    const defaultFormId = normalizeFormId(pokemonLike?.defaultFormId || 'normal')
    const forms = Array.isArray(pokemonLike?.forms) && pokemonLike.forms.length > 0
        ? pokemonLike.forms
        : [{ formId: defaultFormId, formName: defaultFormId }]

    return forms
        .map((form) => ({
            formId: normalizeFormId(form?.formId || defaultFormId),
            formName: String(form?.formName || '').trim() || normalizeFormId(form?.formId || defaultFormId),
        }))
        .filter((form, index, arr) => arr.findIndex((entry) => entry.formId === form.formId) === index)
}

const toRewardPreview = (codeLike, itemMap, pokemonMap) => {
    const parts = []

    const platinumCoinsAmount = Math.max(0, Number.parseInt(codeLike?.platinumCoinsAmount, 10) || 0)
    const moonPointsAmount = Math.max(0, Number.parseInt(codeLike?.moonPointsAmount, 10) || 0)

    if (platinumCoinsAmount > 0) {
        parts.push(`${platinumCoinsAmount.toLocaleString('vi-VN')} Xu Bạch Kim`)
    }
    if (moonPointsAmount > 0) {
        parts.push(`${moonPointsAmount.toLocaleString('vi-VN')} Điểm Nguyệt Các`)
    }

    const rows = Array.isArray(codeLike?.itemRewards) ? codeLike.itemRewards : []
    rows.forEach((row) => {
        const qty = Number(row?.quantity || 0)
        if (qty <= 0) return
        const item = itemMap.get(row?.itemId || row?.item?._id)
        parts.push(`${qty.toLocaleString('vi-VN')} x ${item?.name || 'Vật phẩm'}`)
    })

    const pokemonQuantity = Math.max(0, Number.parseInt(codeLike?.pokemonQuantity, 10) || 0)
    if (pokemonQuantity > 0) {
        const pokemon = pokemonMap.get(codeLike?.pokemonId || codeLike?.pokemon?._id)
        const name = pokemon?.name || codeLike?.pokemon?.name || 'Pokemon'
        const level = Math.max(1, Number.parseInt(codeLike?.pokemonLevel ?? codeLike?.pokemonConfig?.level, 10) || 5)
        const shinyText = codeLike?.isShiny || codeLike?.pokemonConfig?.isShiny ? ' (Shiny)' : ''
        parts.push(`${pokemonQuantity.toLocaleString('vi-VN')} x ${name} Lv.${level}${shinyText}`)
    }

    return parts.length > 0 ? parts.join(', ') : 'Chưa có phần thưởng'
}

export default function PromoCodeManagerPage() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [codes, setCodes] = useState([])
    const [items, setItems] = useState([])
    const [pokemon, setPokemon] = useState([])
    const [editingId, setEditingId] = useState('')
    const [search, setSearch] = useState('')
    const [form, setForm] = useState(buildInitialForm)
    const [pokemonPickerOpen, setPokemonPickerOpen] = useState(false)
    const [pokemonPickerSearch, setPokemonPickerSearch] = useState('')
    const [itemPickerOpen, setItemPickerOpen] = useState(false)
    const [itemPickerSearch, setItemPickerSearch] = useState('')
    const [itemPickerTargetIndex, setItemPickerTargetIndex] = useState(0)

    const itemMap = useMemo(() => new Map(items.map((entry) => [entry._id, entry])), [items])
    const pokemonMap = useMemo(() => new Map(pokemon.map((entry) => [entry._id, entry])), [pokemon])

    const filteredCodes = useMemo(() => {
        const q = String(search || '').trim().toLowerCase()
        if (!q) return codes
        return codes.filter((entry) =>
            String(entry?.code || '').toLowerCase().includes(q)
            || String(entry?.title || '').toLowerCase().includes(q)
        )
    }, [codes, search])

    const filteredPokemonOptions = useMemo(() => {
        const q = String(pokemonPickerSearch || '').trim().toLowerCase()
        if (!q) return pokemon
        return pokemon.filter((entry) => {
            const name = String(entry?.name || '').toLowerCase()
            const dex = String(entry?.pokedexNumber || '').toLowerCase()
            return name.includes(q) || dex.includes(q)
        })
    }, [pokemon, pokemonPickerSearch])

    const filteredItemOptions = useMemo(() => {
        const q = String(itemPickerSearch || '').trim().toLowerCase()
        if (!q) return items
        return items.filter((entry) => String(entry?.name || '').toLowerCase().includes(q))
    }, [items, itemPickerSearch])

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        try {
            setLoading(true)
            setError('')
            const data = await promoCodeApi.list()
            setCodes(Array.isArray(data?.codes) ? data.codes : [])
            setItems(Array.isArray(data?.meta?.items) ? data.meta.items : [])
            setPokemon(Array.isArray(data?.meta?.pokemon) ? data.meta.pokemon : [])
        } catch (err) {
            setError(err.message || 'Không thể tải mã code')
        } finally {
            setLoading(false)
        }
    }

    const resetForm = () => {
        setEditingId('')
        setForm(buildInitialForm())
        setPokemonPickerOpen(false)
        setPokemonPickerSearch('')
        setItemPickerOpen(false)
        setItemPickerSearch('')
        setItemPickerTargetIndex(0)
    }

    const handleEdit = (entry) => {
        setEditingId(String(entry?._id || ''))
        setPokemonPickerOpen(false)
        setItemPickerOpen(false)
        setPokemonPickerSearch('')
        setItemPickerSearch('')
        setItemPickerTargetIndex(0)

        const parsedItemRewards = Array.isArray(entry?.itemRewards) && entry.itemRewards.length > 0
            ? entry.itemRewards.map((row) => ({
                itemId: row?.itemId || row?.item?._id || '',
                quantity: Number(row?.quantity || 1),
            }))
            : (entry?.item?._id
                ? [{ itemId: entry.item._id, quantity: Number(entry?.amount || 1) }]
                : [buildItemRewardRow()])

        setForm({
            code: entry?.code || '',
            title: entry?.title || '',
            description: entry?.description || '',
            rewardType: 'bundle',
            amount: Number(entry?.amount || 1),
            platinumCoinsAmount: Number(entry?.platinumCoinsAmount || 0),
            moonPointsAmount: Number(entry?.moonPointsAmount || 0),
            itemRewards: parsedItemRewards,
            pokemonId: entry?.pokemon?._id || '',
            pokemonQuantity: Number(entry?.pokemonQuantity || (entry?.pokemon ? Number(entry?.amount || 1) : 0)),
            formId: normalizeFormId(entry?.pokemonConfig?.formId || entry?.pokemon?.defaultFormId || 'normal'),
            pokemonLevel: Number(entry?.pokemonConfig?.level || 5),
            isShiny: Boolean(entry?.pokemonConfig?.isShiny),
            perUserLimit: Number(entry?.perUserLimit || 1),
            maxTotalClaims: Number.isInteger(entry?.maxTotalClaims) && entry.maxTotalClaims > 0
                ? String(entry.maxTotalClaims)
                : '',
            startsAt: toDatetimeLocalValue(entry?.startsAt),
            endsAt: toDatetimeLocalValue(entry?.endsAt),
            isActive: Boolean(entry?.isActive),
        })
    }

    const updateForm = (patch) => {
        setForm((prev) => ({ ...prev, ...patch }))
    }

    useEffect(() => {
        if (Number(form.pokemonQuantity || 0) <= 0) return
        const selectedPokemon = pokemonMap.get(form.pokemonId)
        if (!selectedPokemon) return

        const forms = getPokemonForms(selectedPokemon)
        if (forms.length === 0) return

        const hasSelectedForm = forms.some((entry) => entry.formId === normalizeFormId(form.formId))
        if (!hasSelectedForm) {
            updateForm({ formId: forms[0].formId || 'normal' })
        }
    }, [form.pokemonQuantity, form.pokemonId, form.formId, pokemonMap])

    const openPokemonPicker = () => {
        setPokemonPickerSearch('')
        setPokemonPickerOpen(true)
    }

    const closePokemonPicker = () => {
        if (saving) return
        setPokemonPickerOpen(false)
    }

    const openItemPicker = (targetIndex = 0) => {
        setItemPickerSearch('')
        setItemPickerTargetIndex(targetIndex)
        setItemPickerOpen(true)
    }

    const closeItemPicker = () => {
        if (saving) return
        setItemPickerOpen(false)
    }

    const updateItemRewardRow = (index, patch) => {
        setForm((prev) => {
            const rows = Array.isArray(prev.itemRewards) && prev.itemRewards.length > 0
                ? [...prev.itemRewards]
                : [buildItemRewardRow()]
            if (!rows[index]) return prev
            rows[index] = { ...rows[index], ...patch }
            return { ...prev, itemRewards: rows }
        })
    }

    const addItemRewardRow = () => {
        setForm((prev) => {
            const rows = Array.isArray(prev.itemRewards) ? [...prev.itemRewards] : []
            rows.push(buildItemRewardRow())
            return { ...prev, itemRewards: rows }
        })
    }

    const removeItemRewardRow = (index) => {
        setForm((prev) => {
            const rows = Array.isArray(prev.itemRewards) ? [...prev.itemRewards] : []
            if (rows.length <= 1) {
                return { ...prev, itemRewards: [buildItemRewardRow()] }
            }
            rows.splice(index, 1)
            return { ...prev, itemRewards: rows }
        })
    }

    const handleSelectPokemon = (entry) => {
        const forms = getPokemonForms(entry)
        updateForm({
            pokemonId: entry?._id || '',
            formId: forms[0]?.formId || 'normal',
        })
        setPokemonPickerOpen(false)
    }

    const handleSelectItem = (entry) => {
        updateItemRewardRow(itemPickerTargetIndex, { itemId: entry?._id || '' })
        setItemPickerOpen(false)
    }

    const handleSave = async () => {
        try {
            setSaving(true)
            setError('')
            setSuccess('')

            const normalizedItemRewards = (Array.isArray(form.itemRewards) ? form.itemRewards : [])
                .map((row) => ({
                    itemId: String(row?.itemId || '').trim(),
                    quantity: Number.parseInt(row?.quantity, 10),
                }))
                .filter((row) => row.itemId)

            const totalItemAmount = normalizedItemRewards.reduce((sum, row) => {
                const safeQty = Number.isInteger(row.quantity) && row.quantity > 0 ? row.quantity : 0
                return sum + safeQty
            }, 0)

            const normalizedPokemonQuantity = Math.max(0, Math.min(100, Number.parseInt(form.pokemonQuantity, 10) || 0))
            const normalizedCoins = Math.max(0, Number.parseInt(form.platinumCoinsAmount, 10) || 0)
            const normalizedMoonPoints = Math.max(0, Number.parseInt(form.moonPointsAmount, 10) || 0)
            const normalizedAmount = Math.max(1, normalizedCoins + normalizedMoonPoints + totalItemAmount + normalizedPokemonQuantity)

            const payload = {
                code: String(form.code || '').trim().toUpperCase(),
                title: String(form.title || '').trim(),
                description: String(form.description || '').trim(),
                rewardType: 'bundle',
                amount: normalizedAmount,
                platinumCoinsAmount: normalizedCoins,
                moonPointsAmount: normalizedMoonPoints,
                itemId: normalizedItemRewards[0]?.itemId || null,
                itemRewards: normalizedItemRewards,
                pokemonId: normalizedPokemonQuantity > 0 ? form.pokemonId : null,
                pokemonQuantity: normalizedPokemonQuantity,
                formId: normalizedPokemonQuantity > 0 ? normalizeFormId(form.formId || 'normal') : 'normal',
                pokemonLevel: normalizedPokemonQuantity > 0
                    ? Math.max(1, Math.min(3000, Number.parseInt(form.pokemonLevel, 10) || 5))
                    : 5,
                isShiny: normalizedPokemonQuantity > 0 ? Boolean(form.isShiny) : false,
                perUserLimit: Number.parseInt(form.perUserLimit, 10),
                maxTotalClaims: String(form.maxTotalClaims || '').trim() === ''
                    ? null
                    : Number.parseInt(form.maxTotalClaims, 10),
                startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
                endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
                isActive: Boolean(form.isActive),
            }

            const res = editingId
                ? await promoCodeApi.update(editingId, payload)
                : await promoCodeApi.create(payload)

            const changedCode = res?.code
            if (changedCode?._id) {
                setCodes((prev) => {
                    const exists = prev.some((entry) => entry._id === changedCode._id)
                    if (exists) {
                        return prev.map((entry) => (entry._id === changedCode._id ? changedCode : entry))
                    }
                    return [changedCode, ...prev]
                })
            } else {
                await loadData()
            }

            setSuccess(res?.message || 'Lưu mã code thành công')
            resetForm()
        } catch (err) {
            setError(err.message || 'Không thể lưu mã code')
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (entry) => {
        const id = String(entry?._id || '').trim()
        if (!id) return

        const confirmed = window.confirm(`Xóa mã ${entry.code}? Hành động này không thể hoàn tác.`)
        if (!confirmed) return

        try {
            setError('')
            setSuccess('')
            const res = await promoCodeApi.delete(id)
            setCodes((prev) => prev.filter((row) => row._id !== id))
            if (editingId === id) {
                resetForm()
            }
            setSuccess(res?.message || 'Đã xóa mã code')
        } catch (err) {
            setError(err.message || 'Xóa mã code thất bại')
        }
    }

    const handleAutoGenerateCode = () => {
        const code = buildAutoCode(form.title)
        updateForm({ code })
        setError('')
        setSuccess('Đã tạo mã tự động')
    }

    if (loading) {
        return <div className="text-center py-8 text-blue-800 font-medium">Đang tải dữ liệu mã code...</div>
    }

    const selectedPokemon = pokemonMap.get(form.pokemonId)
    const itemRewards = Array.isArray(form.itemRewards) && form.itemRewards.length > 0
        ? form.itemRewards
        : [buildItemRewardRow()]
    const pokemonForms = getPokemonForms(selectedPokemon)

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between gap-3 sm:items-center bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Quản Lý Mã Code</h1>
                    <p className="text-sm text-slate-500 mt-1">Tạo mã quà tặng để người chơi nhập và nhận thưởng.</p>
                </div>
                <Link
                    to="/admin"
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold shadow-sm transition-all"
                >
                    Quay lại
                </Link>
            </div>

            {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm font-medium">
                    {error}
                </div>
            )}

            {success && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-sm font-medium">
                    {success}
                </div>
            )}

            <section className="bg-white border border-blue-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 border-b border-blue-600">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                        {editingId ? `Chỉnh sửa mã ${form.code || ''}` : 'Tạo mã code mới'}
                    </h2>
                </div>

                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Mã code</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={form.code}
                                maxLength={30}
                                onChange={(e) => updateForm({ code: sanitizeCodeToken(e.target.value) })}
                                placeholder="VD: TET2026"
                                className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                                type="button"
                                onClick={handleAutoGenerateCode}
                                className="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded text-xs font-bold shadow-sm"
                            >
                                Tự tạo mã
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Tiêu đề</label>
                        <input
                            type="text"
                            value={form.title}
                            maxLength={120}
                            onChange={(e) => updateForm({ title: e.target.value })}
                            placeholder="Quà tân thủ"
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-600 mb-1">Mô tả (tuỳ chọn)</label>
                        <textarea
                            rows={2}
                            value={form.description}
                            onChange={(e) => updateForm({ description: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Xu Bạch Kim</label>
                        <input
                            type="number"
                            min="0"
                            max="999999999"
                            value={form.platinumCoinsAmount}
                            onChange={(e) => updateForm({ platinumCoinsAmount: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Điểm Nguyệt Các</label>
                        <input
                            type="number"
                            min="0"
                            max="999999999"
                            value={form.moonPointsAmount}
                            onChange={(e) => updateForm({ moonPointsAmount: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="md:col-span-2 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <label className="block text-xs font-bold text-slate-600">Danh sách vật phẩm thưởng</label>
                            <button
                                type="button"
                                onClick={addItemRewardRow}
                                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-sm"
                            >
                                + Thêm vật phẩm
                            </button>
                        </div>

                        <div className="space-y-2">
                            {itemRewards.map((row, index) => {
                                const selected = itemMap.get(row.itemId)
                                return (
                                    <div key={`item-reward-${index}`} className="p-2.5 border border-slate-200 rounded bg-slate-50">
                                        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                            <button
                                                type="button"
                                                onClick={() => openItemPicker(index)}
                                                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-bold shadow-sm"
                                            >
                                                Chọn vật phẩm
                                            </button>

                                            <div className="flex-1 p-2 border border-slate-200 rounded bg-white text-sm text-slate-700">
                                                {selected ? (
                                                    <div className="flex items-center gap-2">
                                                        <img
                                                            src={selected.imageUrl || DEFAULT_ITEM_IMAGE}
                                                            alt={selected.name}
                                                            className="w-7 h-7 object-contain"
                                                            onError={(e) => {
                                                                e.currentTarget.onerror = null
                                                                e.currentTarget.src = DEFAULT_ITEM_IMAGE
                                                            }}
                                                        />
                                                        <div>
                                                            <div className="font-bold">{selected.name}</div>
                                                            <div className="text-xs text-slate-500">{selected.type} • {selected.rarity}</div>
                                                        </div>
                                                    </div>
                                                ) : 'Chưa chọn vật phẩm'}
                                            </div>

                                            <div className="w-full sm:w-28">
                                                <label className="block text-[11px] font-bold text-slate-600 mb-1">Số lượng</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="99999"
                                                    value={row.quantity}
                                                    onChange={(e) => updateItemRewardRow(index, { quantity: e.target.value })}
                                                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                />
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => removeItemRewardRow(index)}
                                                className="px-3 py-2 bg-white border border-red-200 hover:bg-red-50 text-red-700 rounded text-sm font-bold"
                                            >
                                                Xóa
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    <div className="md:col-span-2 p-3 border border-blue-200 rounded bg-blue-50/40 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">Số lượng Pokemon thưởng</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={form.pokemonQuantity}
                                    onChange={(e) => updateForm({ pokemonQuantity: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div className="text-xs text-slate-500 flex items-end">
                                Đặt 0 nếu không tặng Pokemon.
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Pokemon</label>
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                <button
                                    type="button"
                                    onClick={openPokemonPicker}
                                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold shadow-sm"
                                >
                                    Chọn Pokemon
                                </button>

                                <div className="flex-1 p-2.5 border border-slate-200 rounded bg-white text-sm text-slate-700">
                                    {selectedPokemon ? (
                                        <div className="flex items-center gap-2">
                                            <img
                                                src={selectedPokemon.sprite || DEFAULT_POKEMON_IMAGE}
                                                alt={selectedPokemon.name}
                                                className="w-8 h-8 object-contain pixelated"
                                                onError={(e) => {
                                                    e.currentTarget.onerror = null
                                                    e.currentTarget.src = DEFAULT_POKEMON_IMAGE
                                                }}
                                            />
                                            <div>
                                                <div className="font-bold">{selectedPokemon.name}</div>
                                                <div className="text-xs text-slate-500">#{String(selectedPokemon.pokedexNumber || 0).padStart(3, '0')}</div>
                                            </div>
                                        </div>
                                    ) : 'Chưa chọn Pokemon'}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">Form</label>
                                <select
                                    value={form.formId}
                                    onChange={(e) => updateForm({ formId: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    {pokemonForms.map((entry) => (
                                        <option key={entry.formId} value={entry.formId}>{entry.formName}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">Level Pokemon</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="3000"
                                    value={form.pokemonLevel}
                                    onChange={(e) => updateForm({ pokemonLevel: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                            <input
                                type="checkbox"
                                checked={Boolean(form.isShiny)}
                                onChange={(e) => updateForm({ isShiny: e.target.checked })}
                                className="accent-blue-600"
                            />
                            Shiny
                        </label>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Giới hạn / người</label>
                        <input
                            type="number"
                            min="1"
                            max="100"
                            value={form.perUserLimit}
                            onChange={(e) => updateForm({ perUserLimit: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Tổng lượt nhập (để trống = không giới hạn)</label>
                        <input
                            type="number"
                            min="1"
                            max="999999"
                            value={form.maxTotalClaims}
                            onChange={(e) => updateForm({ maxTotalClaims: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Bắt đầu (tuỳ chọn)</label>
                        <input
                            type="datetime-local"
                            value={form.startsAt}
                            onChange={(e) => updateForm({ startsAt: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Kết thúc (tuỳ chọn)</label>
                        <input
                            type="datetime-local"
                            value={form.endsAt}
                            onChange={(e) => updateForm({ endsAt: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 md:col-span-2">
                        <input
                            type="checkbox"
                            checked={Boolean(form.isActive)}
                            onChange={(e) => updateForm({ isActive: e.target.checked })}
                            className="accent-blue-600"
                        />
                        Kích hoạt mã
                    </label>

                    <div className="md:col-span-2 p-2.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600">
                        <span className="font-bold text-slate-700">Xem nhanh:</span> {toRewardPreview(form, itemMap, pokemonMap)}
                    </div>

                    <div className="md:col-span-2 flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={saving}
                            onClick={handleSave}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {saving ? 'Đang lưu...' : editingId ? 'Cập nhật mã' : 'Tạo mã'}
                        </button>
                        {editingId && (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-sm font-bold"
                            >
                                Hủy sửa
                            </button>
                        )}
                    </div>
                </div>
            </section>

            <section className="bg-white border border-blue-200 rounded-lg shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Danh sách mã code ({codes.length})</h2>
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Tìm theo mã hoặc tiêu đề..."
                        className="w-full sm:w-72 px-3 py-1.5 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                {filteredCodes.length === 0 ? (
                    <div className="p-4 text-sm text-slate-500">Chưa có mã code nào.</div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {filteredCodes.map((entry) => (
                            <div key={entry._id} className="p-4 flex flex-col gap-2">
                                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-xs font-black tracking-wide">
                                                {entry.code}
                                            </span>
                                            <span className="font-bold text-slate-800">{entry.title}</span>
                                            {!entry.isActive && (
                                                <span className="px-2 py-0.5 rounded border border-slate-300 bg-slate-100 text-[11px] font-bold text-slate-600">
                                                    Tạm khóa
                                                </span>
                                            )}
                                            {entry?.status?.isExpired && (
                                                <span className="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-[11px] font-bold text-red-700">
                                                    Hết hạn
                                                </span>
                                            )}
                                        </div>
                                        {entry.description && (
                                            <p className="text-sm text-slate-500 mt-1">{entry.description}</p>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleEdit(entry)}
                                            className="px-3 py-1.5 text-xs font-bold rounded border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100"
                                        >
                                            Sửa
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(entry)}
                                            className="px-3 py-1.5 text-xs font-bold rounded border border-red-200 text-red-700 bg-red-50 hover:bg-red-100"
                                        >
                                            Xóa
                                        </button>
                                    </div>
                                </div>

                                <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                                    <span><b>Thưởng:</b> {toRewardPreview(entry, itemMap, pokemonMap)}</span>
                                    <span><b>Đã dùng:</b> {Number(entry.claimCount || 0).toLocaleString('vi-VN')}</span>
                                    <span><b>Còn lại:</b> {entry.remainingClaims === null ? 'Không giới hạn' : Number(entry.remainingClaims).toLocaleString('vi-VN')}</span>
                                    <span><b>Giới hạn/người:</b> {Number(entry.perUserLimit || 1).toLocaleString('vi-VN')}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {pokemonPickerOpen && (
                <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white w-full max-w-2xl rounded-lg border border-slate-200 shadow-2xl max-h-[92vh] overflow-y-auto">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-800">Chọn Pokemon thưởng</h3>
                            <button
                                type="button"
                                onClick={closePokemonPicker}
                                disabled={saving}
                                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <input
                                type="text"
                                value={pokemonPickerSearch}
                                onChange={(e) => setPokemonPickerSearch(e.target.value)}
                                placeholder="Nhập tên hoặc số Pokedex"
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />

                            <div className="border border-slate-200 rounded-md max-h-72 overflow-y-auto">
                                {filteredPokemonOptions.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy Pokemon</div>
                                ) : (
                                    filteredPokemonOptions.map((entry) => {
                                        const forms = getPokemonForms(entry)
                                        return (
                                            <button
                                                type="button"
                                                key={entry._id}
                                                onClick={() => handleSelectPokemon(entry)}
                                                className={`w-full px-3 py-2 border-b border-slate-100 text-left flex items-center gap-3 hover:bg-blue-50 ${form.pokemonId === entry._id ? 'bg-blue-50' : ''}`}
                                            >
                                                <img
                                                    src={entry.sprite || DEFAULT_POKEMON_IMAGE}
                                                    alt={entry.name}
                                                    className="w-10 h-10 object-contain pixelated"
                                                    onError={(e) => {
                                                        e.currentTarget.onerror = null
                                                        e.currentTarget.src = DEFAULT_POKEMON_IMAGE
                                                    }}
                                                />
                                                <div className="min-w-0">
                                                    <div className="font-bold text-slate-800 truncate">{entry.name}</div>
                                                    <div className="text-xs text-slate-500 font-mono">#{String(entry.pokedexNumber || 0).padStart(3, '0')}</div>
                                                    <div className="mt-1 flex flex-wrap gap-1">
                                                        {forms.slice(0, 4).map((formEntry) => (
                                                            <span
                                                                key={`${entry._id}-${formEntry.formId}`}
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
                                            </button>
                                        )
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {itemPickerOpen && (
                <div className="fixed inset-0 bg-slate-900/55 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white w-full max-w-xl rounded-lg border border-slate-200 shadow-2xl max-h-[92vh] overflow-y-auto">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-800">Chọn vật phẩm thưởng</h3>
                            <button
                                type="button"
                                onClick={closeItemPicker}
                                disabled={saving}
                                className="text-slate-400 hover:text-slate-600 disabled:opacity-50"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <input
                                type="text"
                                value={itemPickerSearch}
                                onChange={(e) => setItemPickerSearch(e.target.value)}
                                placeholder="Nhập tên vật phẩm"
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />

                            <div className="border border-slate-200 rounded-md max-h-72 overflow-y-auto">
                                {filteredItemOptions.length === 0 ? (
                                    <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy vật phẩm</div>
                                ) : (
                                    filteredItemOptions.map((entry) => (
                                        <button
                                            type="button"
                                            key={entry._id}
                                            onClick={() => handleSelectItem(entry)}
                                            className={`w-full px-3 py-2 border-b border-slate-100 text-left flex items-center gap-3 hover:bg-emerald-50 ${(itemRewards[itemPickerTargetIndex]?.itemId || '') === entry._id ? 'bg-emerald-50' : ''}`}
                                        >
                                            <img
                                                src={entry.imageUrl || DEFAULT_ITEM_IMAGE}
                                                alt={entry.name}
                                                className="w-8 h-8 object-contain"
                                                onError={(e) => {
                                                    e.currentTarget.onerror = null
                                                    e.currentTarget.src = DEFAULT_ITEM_IMAGE
                                                }}
                                            />
                                            <div className="min-w-0">
                                                <div className="font-bold text-slate-800 truncate">{entry.name}</div>
                                                <div className="text-xs text-slate-500">{entry.type} • {entry.rarity}</div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
