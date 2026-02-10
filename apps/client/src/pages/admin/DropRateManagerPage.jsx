import { useState, useEffect } from 'react'
import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { mapApi, pokemonApi, dropRateApi } from '../../services/adminApi'

export default function DropRateManagerPage() {
    const { mapId } = useParams()

    const [map, setMap] = useState(null)
    const [dropRates, setDropRates] = useState([])
    const [totalWeight, setTotalWeight] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    // Add Pokemon Modal State
    const [showAddModal, setShowAddModal] = useState(false)
    const [allPokemon, setAllPokemon] = useState([])
    const [selectedPokemonIds, setSelectedPokemonIds] = useState([])
    const [bulkWeight, setBulkWeight] = useState(10)
    const [formId, setFormId] = useState('normal')
    const [searchTerm, setSearchTerm] = useState('')
    const [bulkLoading, setBulkLoading] = useState(false)

    // Edit State
    const [editingId, setEditingId] = useState(null)
    const [editWeight, setEditWeight] = useState(0)

    useEffect(() => {
        loadData()
    }, [mapId])

    const loadData = async () => {
        try {
            setLoading(true)
            const [mapData, pokemonData] = await Promise.all([
                mapApi.getDropRates(mapId),
                pokemonApi.list({ limit: 1000 }) // Get all pokemon for dropdown
            ])

            setMap(mapData.map)
            setDropRates(mapData.dropRates)
            setTotalWeight(mapData.totalWeight)
            setAllPokemon(pokemonData.pokemon)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleAddDropRate = async () => {
        if (selectedPokemonIds.length === 0 || bulkWeight < 0) return

        try {
            setBulkLoading(true)
            const normalizedFormId = String(formId || '').trim().toLowerCase() || 'normal'
            await Promise.all(
                selectedPokemonIds.map((pokemonId) =>
                    dropRateApi.upsert({
                        mapId,
                        pokemonId,
                        formId: normalizedFormId,
                        weight: parseInt(bulkWeight),
                    })
                )
            )

            setShowAddModal(false)
            setSelectedPokemonIds([])
            setBulkWeight(10)
            setFormId('normal')
            setSearchTerm('')
            loadData()
        } catch (err) {
            alert('Thêm thất bại: ' + err.message)
        } finally {
            setBulkLoading(false)
        }
    }

    const handleEdit = (dropRate) => {
        setEditingId(dropRate._id)
        setEditWeight(dropRate.weight)
    }

    const handleSaveEdit = async () => {
        if (!editingId || editWeight < 0) return

        try {
            let dr = dropRates.find(d => d._id === editingId)
            const isNewRow = !dr && editingId.startsWith('new-')
            if (isNewRow) {
                const parts = editingId.replace('new-', '').split('-')
                const pokemonId = parts[0]
                const formId = parts.slice(1).join('-')
                dr = { pokemon: { _id: pokemonId }, formId }
            }
            await dropRateApi.upsert({
                mapId,
                pokemonId: dr.pokemon._id,
                formId: dr.formId,
                weight: parseInt(editWeight),
            })
            setEditingId(null)
            loadData()
        } catch (err) {
            alert('Cập nhật thất bại: ' + err.message)
        }
    }

    const handleCancelEdit = () => {
        setEditingId(null)
        setEditWeight(0)
    }

    const handleDelete = async (dropRateId, pokemonName) => {
        if (!confirm(`Xóa ${pokemonName} khỏi bản đồ này?`)) return

        try {
            await dropRateApi.delete(dropRateId)
            loadData()
        } catch (err) {
            alert('Xóa thất bại: ' + err.message)
        }
    }

    if (loading) return <div className="text-blue-800 font-medium text-center py-8">Đang tải dữ liệu...</div>
    if (!map) return <div className="text-red-500 font-medium text-center py-8">Không tìm thấy bản đồ</div>

    const normalizedFormId = String(formId || '').trim().toLowerCase() || 'normal'
    const existingDropRateKeys = new Set(
        dropRates.map((dr) => `${dr.pokemon?._id}:${String(dr.formId || '').trim().toLowerCase() || 'normal'}`)
    )
    const normalizeDropRateFormId = (value) => String(value || '').trim().toLowerCase() || 'normal'
    const groupedDropRates = () => {
        const groups = []
        const groupMap = new Map()

        dropRates.forEach((dr) => {
            const pokemonId = dr.pokemon?._id
            if (!pokemonId) return
            if (!groupMap.has(pokemonId)) {
                const entry = { pokemon: dr.pokemon, entries: [] }
                groupMap.set(pokemonId, entry)
                groups.push(entry)
            }
            groupMap.get(pokemonId).entries.push(dr)
        })

        return groups.map((group) => {
            const pokemon = group.pokemon
            const forms = Array.isArray(pokemon.forms) && pokemon.forms.length > 0
                ? pokemon.forms
                : [{ formId: pokemon.defaultFormId || 'normal', formName: pokemon.defaultFormId || 'normal', imageUrl: pokemon.imageUrl || '' }]
            const defaultFormId = normalizeDropRateFormId(pokemon.defaultFormId || forms[0]?.formId || 'normal')
            const orderedForms = [
                ...(forms.find((form) => normalizeDropRateFormId(form.formId) === defaultFormId) ? [forms.find((form) => normalizeDropRateFormId(form.formId) === defaultFormId)] : []),
                ...forms.filter((form) => normalizeDropRateFormId(form.formId) !== defaultFormId),
            ].filter(Boolean)

            const dropRateByFormId = new Map(
                group.entries.map((entry) => [normalizeDropRateFormId(entry.formId), entry])
            )

            const entries = orderedForms.map((form) => {
                const formId = normalizeDropRateFormId(form.formId)
                const existingEntry = dropRateByFormId.get(formId)
                if (existingEntry) return existingEntry
                return {
                    _id: `new-${pokemon._id}-${formId}`,
                    pokemon,
                    formId,
                    form,
                    resolvedImageUrl: form.imageUrl || pokemon.imageUrl || '',
                    weight: 0,
                    relativePercent: 0,
                    isMissing: true,
                }
            })

            return { pokemon, entries }
        })
    }
    const filteredPokemon = allPokemon.filter((p) => {
        const name = String(p.name || '').toLowerCase()
        const query = searchTerm.trim().toLowerCase()
        if (!query) return true
        return name.includes(query) || String(p.pokedexNumber).includes(query)
    })

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div>
                    <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <span className="text-blue-600"></span> {map.name} <span className="text-slate-400 font-normal mx-2">|</span> Tỷ lệ rơi
                    </h1>
                    <p className="text-slate-500 text-sm mt-1 flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-bold border border-blue-100">LV {map.levelMin} - {map.levelMax}</span>
                        {map.isLegendary && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-xs font-bold border border-amber-100">🏹 Săn Bắt</span>}
                    </p>
                </div>
                <Link
                    to="/admin/maps"
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold shadow-sm transition-all flex items-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Quay lại
                </Link>
            </div>

            {error && (
                <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-md flex items-center gap-2 shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm font-medium">{error}</span>
                </div>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-blue-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Danh sách Pokemon</h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Tổng trọng số: <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{totalWeight}</span>
                        </p>
                    </div>
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-md text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Thêm Pokemon
                    </button>
                </div>

                {dropRates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                            </svg>
                        </div>
                        <p className="font-medium">Chưa có Pokemon nào trong bản đồ này</p>
                        <p className="text-xs mt-1">Nhấn nút "Thêm Pokemon" để bắt đầu cấu hình</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-slate-700 uppercase text-xs tracking-wider border-b border-slate-200">
                                <tr>
                                    <th className="px-6 py-3 text-left font-bold">Pokemon</th>
                                    <th className="px-6 py-3 text-center font-bold">Trọng số</th>
                                    <th className="px-6 py-3 text-center font-bold">Dạng</th>
                                    <th className="px-6 py-3 text-center font-bold">Tỷ lệ %</th>
                                    <th className="px-6 py-3 text-right font-bold">Hành động</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {groupedDropRates().map((group) => {
                                    const entries = group.entries
                                    const defaultFormId = normalizeDropRateFormId(group.pokemon?.defaultFormId || 'normal')
                                    let baseIndex = entries.findIndex((entry) => normalizeDropRateFormId(entry.formId) === defaultFormId)
                                    if (baseIndex === -1) {
                                        baseIndex = entries.findIndex((entry) => normalizeDropRateFormId(entry.formId) === 'normal')
                                    }
                                    if (baseIndex === -1) baseIndex = 0

                                    const baseEntry = entries[baseIndex]
                                    const extraEntries = entries.filter((_, index) => index !== baseIndex)

                                    return (
                                        <React.Fragment key={group.pokemon._id}>
                                            <tr key={baseEntry._id} className={`transition-colors ${baseEntry.isMissing ? 'bg-amber-50/60' : 'hover:bg-blue-50/30'}`}>
                                                <td className="px-6 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex-shrink-0 w-10 h-10 bg-slate-100 rounded-md border border-slate-200 flex items-center justify-center">
                                                            <img
                                                                src={baseEntry.resolvedImageUrl || baseEntry.pokemon.imageUrl || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${baseEntry.pokemon.pokedexNumber}.png`}
                                                                alt={baseEntry.pokemon.name}
                                                                className="w-8 h-8 pixelated"
                                                                onError={(e) => e.target.style.display = 'none'}
                                                            />
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-slate-800">
                                                                {baseEntry.pokemon.name}
                                                                {((baseEntry.form?.formId || baseEntry.formId) && (baseEntry.form?.formId || baseEntry.formId) !== 'normal') && (
                                                                    <span className="text-xs text-slate-500 font-medium"> ({baseEntry.form?.formName || baseEntry.form?.formId || baseEntry.formId})</span>
                                                                )}
                                                            </div>
                                                            <div className="text-xs text-slate-500 font-mono">#{baseEntry.pokemon.pokedexNumber.toString().padStart(3, '0')}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-3 text-center">
                                                    {baseEntry.isMissing ? (
                                                        <span className="inline-block px-2 py-1 bg-amber-100 text-amber-700 rounded font-mono font-medium border border-amber-200 min-w-[3rem]">
                                                            0
                                                        </span>
                                                    ) : editingId === baseEntry._id ? (
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="100000"
                                                            value={editWeight}
                                                            onChange={(e) => setEditWeight(e.target.value)}
                                                            className="w-20 px-2 py-1 border border-blue-300 rounded font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                            autoFocus
                                                        />
                                                    ) : (
                                                        <span className="inline-block px-2 py-1 bg-slate-100 text-slate-700 rounded font-mono font-medium border border-slate-200 min-w-[3rem]">
                                                            {baseEntry.weight}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-3 text-center">
                                                    <span
                                                        className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                                                        title={baseEntry.form?.formName ? `${baseEntry.form.formName} (${baseEntry.form.formId || baseEntry.formId})` : (baseEntry.form?.formId || baseEntry.formId || 'normal')}
                                                    >
                                                        {baseEntry.form?.formName || baseEntry.form?.formId || baseEntry.formId || 'normal'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3 text-center">
                                                    <div className="flex flex-col items-center">
                                                        <span className="font-bold text-green-600">{baseEntry.relativePercent}%</span>
                                                        <div className="w-16 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${baseEntry.relativePercent}%` }}></div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-3 text-right">
                                                    <div className="flex items-center gap-2 justify-end">
                                                        {baseEntry.isMissing ? (
                                                            <button
                                                                onClick={() => handleEdit(baseEntry)}
                                                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-sm transition-all flex items-center gap-1"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                    <path d="M10 2a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H3a1 1 0 110-2h6V3a1 1 0 011-1z" />
                                                                </svg>
                                                                Thêm
                                                            </button>
                                                        ) : editingId === baseEntry._id ? (
                                                            <>
                                                                <button
                                                                    onClick={handleSaveEdit}
                                                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-sm transition-all flex items-center gap-1"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                    </svg>
                                                                    Lưu
                                                                </button>
                                                                <button
                                                                    onClick={handleCancelEdit}
                                                                    className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-bold shadow-sm transition-all"
                                                                >
                                                                    Hủy
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => handleEdit(baseEntry)}
                                                                    className="px-3 py-1.5 bg-white border border-blue-200 hover:bg-blue-50 text-blue-600 rounded text-xs font-bold shadow-sm transition-all flex items-center gap-1"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                                                    </svg>
                                                                    Sửa
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDelete(baseEntry._id, baseEntry.pokemon.name)}
                                                                    className="px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 rounded text-xs font-bold shadow-sm transition-all flex items-center gap-1"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                                    </svg>
                                                                    Xóa
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {extraEntries.map((entry) => (
                                                <tr key={entry._id} className={`${entry.isMissing ? 'bg-amber-50/60' : 'bg-slate-50/60'}`}>
                                                    <td className="px-6 py-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="text-slate-400 font-mono text-xs">↳</div>
                                                            <div className="flex-shrink-0 w-10 h-10 bg-slate-100 rounded-md border border-slate-200 flex items-center justify-center">
                                                                <img
                                                                    src={entry.resolvedImageUrl || entry.pokemon.imageUrl || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${entry.pokemon.pokedexNumber}.png`}
                                                                    alt={entry.pokemon.name}
                                                                    className="w-8 h-8 pixelated"
                                                                    onError={(e) => e.target.style.display = 'none'}
                                                                />
                                                            </div>
                                                            <div>
                                                                <div className="font-semibold text-slate-700">
                                                                    {entry.pokemon.name}
                                                                    <span className="text-xs text-slate-500 italic"> ({entry.form?.formName || entry.form?.formId || entry.formId || 'normal'})</span>
                                                                </div>
                                                                <div className="text-xs text-slate-400 font-mono">#{entry.pokemon.pokedexNumber.toString().padStart(3, '0')}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-3 text-center">
                                                        {entry.isMissing ? (
                                                            <span className="inline-block px-2 py-1 bg-amber-100 text-amber-700 rounded font-mono font-medium border border-amber-200 min-w-[3rem]">
                                                                0
                                                            </span>
                                                        ) : editingId === entry._id ? (
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max="100000"
                                                                value={editWeight}
                                                                onChange={(e) => setEditWeight(e.target.value)}
                                                                className="w-20 px-2 py-1 border border-blue-300 rounded font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                autoFocus
                                                            />
                                                        ) : (
                                                            <span className="inline-block px-2 py-1 bg-slate-100 text-slate-700 rounded font-mono font-medium border border-slate-200 min-w-[3rem]">
                                                                {entry.weight}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-6 py-3 text-center">
                                                        <span
                                                            className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 border border-blue-200"
                                                            title={entry.form?.formName ? `${entry.form.formName} (${entry.form.formId || entry.formId})` : (entry.form?.formId || entry.formId || 'normal')}
                                                        >
                                                            {entry.form?.formName || entry.form?.formId || entry.formId || 'normal'}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-3 text-center">
                                                        <div className="flex flex-col items-center">
                                                            <span className="font-bold text-green-600">{entry.relativePercent}%</span>
                                                            <div className="w-16 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                                                <div className="h-full bg-green-500 rounded-full" style={{ width: `${entry.relativePercent}%` }}></div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-3 text-right">
                                                        <div className="flex items-center gap-2 justify-end">
                                                            {entry.isMissing ? (
                                                                <button
                                                                    onClick={() => handleEdit(entry)}
                                                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-sm transition-all flex items-center gap-1"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path d="M10 2a1 1 0 011 1v6h6a1 1 0 110 2h-6v6a1 1 0 11-2 0v-6H3a1 1 0 110-2h6V3a1 1 0 011-1z" />
                                                                    </svg>
                                                                    Thêm
                                                                </button>
                                                            ) : editingId === entry._id ? (
                                                                <>
                                                                    <button
                                                                        onClick={handleSaveEdit}
                                                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold shadow-sm transition-all flex items-center gap-1"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                        </svg>
                                                                        Lưu
                                                                    </button>
                                                                    <button
                                                                        onClick={handleCancelEdit}
                                                                        className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-bold shadow-sm transition-all"
                                                                    >
                                                                        Hủy
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        onClick={() => handleEdit(entry)}
                                                                        className="px-3 py-1.5 bg-white border border-blue-200 hover:bg-blue-50 text-blue-600 rounded text-xs font-bold shadow-sm transition-all flex items-center gap-1"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                                                        </svg>
                                                                        Sửa
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDelete(entry._id, entry.pokemon.name)}
                                                                        className="px-3 py-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 rounded text-xs font-bold shadow-sm transition-all flex items-center gap-1"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                                        </svg>
                                                                        Xóa
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Light Theme Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
                    <div className="bg-white rounded-lg border border-slate-200 p-6 max-w-sm w-full shadow-2xl transform transition-all scale-100">
                        <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
                            <h3 className="text-lg font-bold text-slate-800">Thêm Pokemon</h3>
                            <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-1.5">Tìm Pokemon</label>
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Nhập tên hoặc số Pokedex #"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-slate-700 text-sm font-bold">
                                        Chọn nhiều Pokemon <span className="text-red-500">*</span>
                                    </label>
                                    <span className="text-xs text-slate-500">
                                        Đã chọn: <span className="font-bold text-blue-700">{selectedPokemonIds.length}</span>
                                    </span>
                                </div>
                                <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-md">
                                    {filteredPokemon.length === 0 ? (
                                        <div className="px-3 py-4 text-sm text-slate-500 text-center">Không tìm thấy</div>
                                    ) : (
                                        filteredPokemon.map((p) => {
                                            const isChecked = selectedPokemonIds.includes(p._id)
                                            const isExisting = existingDropRateKeys.has(`${p._id}:${normalizedFormId}`)
                                            return (
                                                <label
                                                    key={p._id}
                                                    className={`flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-sm cursor-pointer hover:bg-blue-50 ${isExisting ? 'bg-amber-50/40' : ''}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedPokemonIds((prev) => [...prev, p._id])
                                                            } else {
                                                                setSelectedPokemonIds((prev) => prev.filter((id) => id !== p._id))
                                                            }
                                                        }}
                                                    />
                                                    <span className="font-mono text-xs text-slate-500">#{p.pokedexNumber.toString().padStart(3, '0')}</span>
                                                    <span className="font-bold text-slate-700">{p.name}</span>
                                                    {isExisting && <span className="ml-auto text-[10px] text-amber-700 font-bold">Đã có</span>}
                                                </label>
                                            )
                                        })
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-1.5">Form ID</label>
                                <input
                                    type="text"
                                    value={formId}
                                    onChange={(e) => setFormId(e.target.value)}
                                    placeholder="normal"
                                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                />
                                <div className="mt-1 text-xs text-slate-500">Ví dụ: normal, alola, galar, hisui</div>
                                <div className="mt-1 text-xs text-slate-500">Áp dụng cho tất cả Pokemon đã chọn.</div>
                            </div>

                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-1.5">Trọng số (cho tất cả) <span className="text-red-500">*</span></label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        min="0"
                                        max="100000"
                                        value={bulkWeight}
                                        onChange={(e) => setBulkWeight(e.target.value)}
                                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-md text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                                    />
                                </div>
                                <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-100 grid grid-cols-2 gap-2 text-xs">
                                    <span className="text-slate-500">Tỷ lệ ước tính:</span>
                                    <span className="text-right font-bold text-blue-700">
                                        {totalWeight > 0 ? ((bulkWeight / (totalWeight + parseInt(bulkWeight || 0))) * 100).toFixed(2) : 100}%
                                    </span>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4 border-t border-slate-100 mt-2">
                                <button
                                    onClick={handleAddDropRate}
                                    disabled={selectedPokemonIds.length === 0 || bulkLoading}
                                    className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-md text-sm font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {bulkLoading ? 'Đang lưu...' : 'Thêm Ngay'}
                                </button>
                                <button
                                    onClick={() => setShowAddModal(false)}
                                    className="flex-1 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold shadow-sm transition-all"
                                >
                                    Hủy bỏ
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
