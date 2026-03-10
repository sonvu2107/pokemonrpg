import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { dailyRewardApi } from '../../services/adminApi'

const REWARD_TYPE_OPTIONS = [
    { value: 'platinumCoins', label: 'Xu Bạch Kim' },
    { value: 'moonPoints', label: 'Điểm Nguyệt Các' },
    { value: 'item', label: 'Vật phẩm' },
    { value: 'pokemon', label: 'Pokemon' },
]

const normalizeFormId = (value = 'normal') => String(value || '').trim().toLowerCase() || 'normal'

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

const normalizeRewards = (rows, cycleDays) => {
    const safeCycleDays = Math.max(1, Number.parseInt(cycleDays, 10) || 30)
    const source = Array.isArray(rows) ? rows : []
    const byDay = new Map(source.map((entry) => [Number(entry?.day), entry]))

    return Array.from({ length: safeCycleDays }, (_, index) => {
        const day = index + 1
        const reward = byDay.get(day)
        const rewardType = reward?.rewardType || 'platinumCoins'
        return {
            day,
            rewardType,
            amount: Number(reward?.amount || 1),
            itemId: reward?.item?._id || '',
            item: reward?.item || null,
            pokemonId: reward?.pokemon?._id || '',
            pokemon: reward?.pokemon || null,
            pokemonFormId: normalizeFormId(reward?.pokemonConfig?.formId || reward?.pokemon?.defaultFormId || 'normal'),
            pokemonLevel: Number(reward?.pokemonConfig?.level || 5),
            isShiny: Boolean(reward?.pokemonConfig?.isShiny),
            title: reward?.title || '',
        }
    })
}

const formatPreview = (reward, itemMap, pokemonMap) => {
    const amount = Number(reward?.amount || 0)
    if (reward.rewardType === 'platinumCoins') {
        return `${amount.toLocaleString('vi-VN')} Xu Bạch Kim`
    }
    if (reward.rewardType === 'moonPoints') {
        return `${amount.toLocaleString('vi-VN')} Điểm Nguyệt Các`
    }
    if (reward.rewardType === 'pokemon') {
        const pokemon = pokemonMap.get(reward.pokemonId)
        const pokemonName = pokemon?.name || reward?.pokemon?.name || 'Pokemon'
        const level = Math.max(1, Number.parseInt(reward?.pokemonLevel, 10) || 5)
        const shinyText = reward?.isShiny ? ' (Shiny)' : ''
        return `${amount.toLocaleString('vi-VN')} x ${pokemonName} Lv.${level}${shinyText}`
    }
    const item = itemMap.get(reward.itemId)
    if (!item) return `${amount.toLocaleString('vi-VN')} vật phẩm`
    return `${amount.toLocaleString('vi-VN')} x ${item.name}`
}

export default function DailyRewardManagerPage() {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [saveMessage, setSaveMessage] = useState('')
    const [savingDay, setSavingDay] = useState(null)
    const [cycleDays, setCycleDays] = useState(30)
    const [rewards, setRewards] = useState(() => normalizeRewards([], 30))
    const [items, setItems] = useState([])
    const [pokemon, setPokemon] = useState([])

    const itemMap = useMemo(() => {
        return new Map((items || []).map((item) => [item._id, item]))
    }, [items])

    const pokemonMap = useMemo(() => {
        return new Map((pokemon || []).map((entry) => [entry._id, entry]))
    }, [pokemon])

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        try {
            setLoading(true)
            setError('')
            const data = await dailyRewardApi.list()
            const nextCycleDays = Math.max(1, Number.parseInt(data?.meta?.cycleDays, 10) || 30)
            setCycleDays(nextCycleDays)
            setRewards(normalizeRewards(data?.rewards || [], nextCycleDays))
            setItems(Array.isArray(data?.meta?.items) ? data.meta.items : [])
            setPokemon(Array.isArray(data?.meta?.pokemon) ? data.meta.pokemon : [])
        } catch (err) {
            setError(err.message || 'Không thể tải cấu hình quà hằng ngày')
        } finally {
            setLoading(false)
        }
    }

    const updateLocalReward = (day, patch) => {
        setRewards((prev) => prev.map((entry) => {
            if (entry.day !== day) return entry
            return { ...entry, ...patch }
        }))
    }

    const handleSave = async (reward) => {
        try {
            setSaveMessage('')
            setError('')
            setSavingDay(reward.day)

            const amount = Number.parseInt(reward.amount, 10)
            if (!Number.isInteger(amount) || amount <= 0) {
                throw new Error('Số lượng phải lớn hơn 0')
            }

            if (reward.rewardType === 'item' && !reward.itemId) {
                throw new Error('Vui lòng chọn vật phẩm cho ngày này')
            }

            if (reward.rewardType === 'pokemon' && !reward.pokemonId) {
                throw new Error('Vui lòng chọn Pokemon cho ngày này')
            }

            if (reward.rewardType === 'pokemon' && amount > 100) {
                throw new Error('Số lượng Pokemon tối đa mỗi ngày là 100')
            }

            const payload = {
                rewardType: reward.rewardType,
                amount,
                itemId: reward.rewardType === 'item' ? reward.itemId : null,
                pokemonId: reward.rewardType === 'pokemon' ? reward.pokemonId : null,
                formId: reward.rewardType === 'pokemon' ? normalizeFormId(reward.pokemonFormId || 'normal') : 'normal',
                pokemonLevel: reward.rewardType === 'pokemon'
                    ? Math.max(1, Math.min(2000, Number.parseInt(reward.pokemonLevel, 10) || 5))
                    : 5,
                isShiny: reward.rewardType === 'pokemon' ? Boolean(reward.isShiny) : false,
                title: String(reward.title || '').trim(),
            }

            const data = await dailyRewardApi.update(reward.day, payload)
            const nextCycleDays = Math.max(1, Number.parseInt(data?.meta?.cycleDays, 10) || cycleDays)
            setCycleDays(nextCycleDays)
            setRewards(normalizeRewards(data?.rewards || [], nextCycleDays))
            setSaveMessage(data?.message || `Đã cập nhật quà ngày ${reward.day}`)
        } catch (err) {
            setError(err.message || 'Cập nhật quà thất bại')
        } finally {
            setSavingDay(null)
        }
    }

    if (loading) {
        return <div className="text-center py-8 text-blue-800 font-medium">Đang tải cấu hình điểm danh...</div>
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between gap-3 sm:items-center bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Quản Lý Quà Hằng Ngày</h1>
                    <p className="text-sm text-slate-500 mt-1">Cập nhật quà cho từng ngày trong chu kỳ {cycleDays} ngày.</p>
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

            {saveMessage && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-sm font-medium">
                    {saveMessage}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {rewards.map((reward) => {
                    const isSaving = savingDay === reward.day
                    const selectedItem = itemMap.get(reward.itemId)
                    const selectedPokemon = pokemonMap.get(reward.pokemonId)
                    const pokemonForms = getPokemonForms(selectedPokemon)

                    return (
                        <section key={reward.day} className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                            <div className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 border-b border-blue-600">
                                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Ngày {reward.day}</h2>
                            </div>

                            <div className="p-4 space-y-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Loại quà</label>
                                    <select
                                        value={reward.rewardType}
                                        onChange={(e) => updateLocalReward(reward.day, {
                                            rewardType: e.target.value,
                                            itemId: e.target.value === 'item' ? reward.itemId : '',
                                            pokemonId: e.target.value === 'pokemon'
                                                ? (reward.pokemonId || pokemon[0]?._id || '')
                                                : '',
                                            pokemonFormId: e.target.value === 'pokemon'
                                                ? (reward.pokemonFormId || getPokemonForms(pokemonMap.get(reward.pokemonId || pokemon[0]?._id || ''))[0]?.formId || 'normal')
                                                : 'normal',
                                            pokemonLevel: e.target.value === 'pokemon' ? reward.pokemonLevel : 5,
                                            isShiny: e.target.value === 'pokemon' ? Boolean(reward.isShiny) : false,
                                        })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        {REWARD_TYPE_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Số lượng</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="999999"
                                        value={reward.amount}
                                        onChange={(e) => updateLocalReward(reward.day, { amount: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                {reward.rewardType === 'item' && (
                                    <div>
                                        <label className="block text-xs font-bold text-slate-600 mb-1">Vật phẩm</label>
                                        <select
                                            value={reward.itemId}
                                            onChange={(e) => updateLocalReward(reward.day, { itemId: e.target.value })}
                                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="">Chọn vật phẩm...</option>
                                            {items.map((item) => (
                                                <option key={item._id} value={item._id}>
                                                    {item.name}
                                                </option>
                                            ))}
                                        </select>
                                        {selectedItem && (
                                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                                                <img
                                                    src={selectedItem.imageUrl || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'}
                                                    alt={selectedItem.name}
                                                    className="w-7 h-7 object-contain"
                                                />
                                                <span className="font-semibold">{selectedItem.name}</span>
                                                <span className="text-slate-400">({selectedItem.type})</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {reward.rewardType === 'pokemon' && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-600 mb-1">Pokemon</label>
                                            <select
                                                value={reward.pokemonId}
                                                onChange={(e) => {
                                                    const nextPokemonId = e.target.value
                                                    const nextPokemon = pokemonMap.get(nextPokemonId)
                                                    const nextForms = getPokemonForms(nextPokemon)
                                                    updateLocalReward(reward.day, {
                                                        pokemonId: nextPokemonId,
                                                        pokemonFormId: nextForms[0]?.formId || 'normal',
                                                    })
                                                }}
                                                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value="">Chọn Pokemon...</option>
                                                {pokemon.map((entry) => (
                                                    <option key={entry._id} value={entry._id}>
                                                        #{String(entry.pokedexNumber || 0).padStart(3, '0')} {entry.name}
                                                    </option>
                                                ))}
                                            </select>
                                            {selectedPokemon && (
                                                <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                                                    <img
                                                        src={selectedPokemon.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'}
                                                        alt={selectedPokemon.name}
                                                        className="w-7 h-7 object-contain pixelated"
                                                    />
                                                    <span className="font-semibold">{selectedPokemon.name}</span>
                                                    <span className="text-slate-400">#{String(selectedPokemon.pokedexNumber || 0).padStart(3, '0')}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 mb-1">Form</label>
                                                <select
                                                    value={reward.pokemonFormId}
                                                    onChange={(e) => updateLocalReward(reward.day, { pokemonFormId: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                >
                                                    {pokemonForms.map((form) => (
                                                        <option key={form.formId} value={form.formId}>
                                                            {form.formName || form.formId}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 mb-1">Level Pokemon</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="2000"
                                                    value={reward.pokemonLevel}
                                                    onChange={(e) => updateLocalReward(reward.day, { pokemonLevel: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                            </div>
                                        </div>

                                        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={Boolean(reward.isShiny)}
                                                onChange={(e) => updateLocalReward(reward.day, { isShiny: e.target.checked })}
                                                className="accent-blue-600"
                                            />
                                            Shiny
                                        </label>
                                    </>
                                )}

                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">Tiêu đề (tuỳ chọn)</label>
                                    <input
                                        type="text"
                                        value={reward.title}
                                        maxLength={100}
                                        onChange={(e) => updateLocalReward(reward.day, { title: e.target.value })}
                                        placeholder={`Ví dụ: Thưởng mốc ${cycleDays} ngày`}
                                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>

                                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600">
                                    <span className="font-bold text-slate-700">Xem nhanh:</span> {formatPreview(reward, itemMap, pokemonMap)}
                                </div>

                                <button
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() => handleSave(reward)}
                                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    {isSaving ? 'Đang lưu...' : `Lưu ngày ${reward.day}`}
                                </button>
                            </div>
                        </section>
                    )
                })}
            </div>
        </div>
    )
}
