import React, { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { pokemonApi } from '../../services/adminApi'

const TYPE_COLORS = {
    normal: 'bg-gray-500',
    fire: 'bg-red-500',
    water: 'bg-blue-500',
    grass: 'bg-green-500',
    electric: 'bg-yellow-500',
    ice: 'bg-cyan-400',
    fighting: 'bg-orange-600',
    poison: 'bg-purple-600',
    ground: 'bg-amber-700',
    flying: 'bg-indigo-400',
    psychic: 'bg-pink-500',
    bug: 'bg-lime-600',
    rock: 'bg-stone-600',
    ghost: 'bg-violet-700',
    dragon: 'bg-indigo-700',
    dark: 'bg-gray-800',
    steel: 'bg-slate-500',
    fairy: 'bg-pink-400',
}

export default function PokemonListPage() {
    const [pokemon, setPokemon] = useState([])
    const [allPokemon, setAllPokemon] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [evolutionEdits, setEvolutionEdits] = useState({})
    const [savingId, setSavingId] = useState('')
    const [expandedIds, setExpandedIds] = useState(() => new Set())

    // Scroll Sync
    const tableContainerRef = useRef(null)
    const topScrollRef = useRef(null)

    // Filters
    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [page, setPage] = useState(1)
    const [pagination, setPagination] = useState({ total: 0, pages: 0 })

    useEffect(() => {
        loadPokemon()
    }, [search, typeFilter, page])

    useEffect(() => {
        loadAllPokemon()
    }, [])

    // Sync Top Scrollbar
    useEffect(() => {
        const table = tableContainerRef.current
        const top = topScrollRef.current

        if (!table || !top) return

        const handleTableScroll = () => {
            if (top.scrollLeft !== table.scrollLeft) {
                top.scrollLeft = table.scrollLeft
            }
        }

        const handleTopScroll = () => {
            if (table.scrollLeft !== top.scrollLeft) {
                table.scrollLeft = top.scrollLeft
            }
        }

        table.addEventListener('scroll', handleTableScroll)
        top.addEventListener('scroll', handleTopScroll)

        return () => {
            table.removeEventListener('scroll', handleTableScroll)
            top.removeEventListener('scroll', handleTopScroll)
        }
    }, [pokemon])

    const loadPokemon = async () => {
        try {
            setLoading(true)
            const data = await pokemonApi.list({ search, type: typeFilter, page, limit: 20 })
            setPokemon(data.pokemon)
            setPagination(data.pagination)
            setEvolutionEdits((prev) => {
                const next = { ...prev }
                data.pokemon.forEach((p) => {
                    // Main Pokemon evolution
                    const evolvesTo = typeof p.evolution?.evolvesTo === 'string'
                        ? p.evolution.evolvesTo
                        : p.evolution?.evolvesTo?._id || ''
                    const minLevel = p.evolution?.minLevel ?? ''
                    next[p._id] = { evolvesTo, minLevel: minLevel === null ? '' : minLevel }

                    // Form evolutions
                    if (Array.isArray(p.forms)) {
                        p.forms.forEach(form => {
                            const formEvolvesTo = typeof form.evolution?.evolvesTo === 'string'
                                ? form.evolution.evolvesTo
                                : form.evolution?.evolvesTo?._id || ''
                            const formMinLevel = form.evolution?.minLevel ?? ''
                            next[`${p._id}_${form.formId}`] = { evolvesTo: formEvolvesTo, minLevel: formMinLevel === null ? '' : formMinLevel }
                        })
                    }
                })
                return next
            })
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const loadAllPokemon = async () => {
        try {
            const data = await pokemonApi.list({ limit: 1000 })
            setAllPokemon(data.pokemon || [])
        } catch (err) {
            setError(err.message)
        }
    }

    const updateEvolutionEdit = (id, patch) => {
        setEvolutionEdits((prev) => ({
            ...prev,
            [id]: { ...prev[id], ...patch },
        }))
    }

    const handleSaveEvolution = async (p, formId = null) => {
        const key = formId ? `${p._id}_${formId}` : p._id
        const edit = evolutionEdits[key] || { evolvesTo: '', minLevel: '' }
        const evolvesToValue = edit.evolvesTo || null
        const minLevelValue = evolvesToValue ? (parseInt(edit.minLevel) || null) : null

        try {
            setSavingId(key)
            setError('')

            let payload
            if (formId) {
                if (!Array.isArray(p.forms) || p.forms.length === 0) {
                    throw new Error("Không tìm thấy dữ liệu các dạng của Pokemon này.")
                }
                // Updating a specific form
                const forms = p.forms.map(f => {
                    if (f.formId === formId) {
                        return {
                            ...f,
                            evolution: {
                                ...f.evolution,
                                evolvesTo: evolvesToValue,
                                minLevel: minLevelValue,
                            }
                        }
                    }
                    return f
                })
                payload = { forms }
            } else {
                // Updating main Pokemon
                payload = {
                    evolution: {
                        evolvesTo: evolvesToValue,
                        minLevel: minLevelValue,
                    },
                }
            }

            await pokemonApi.update(p._id, payload)
            await loadPokemon()
        } catch (err) {
            setError(`Lưu tiến hóa thất bại: ${err.message}`)
        } finally {
            setSavingId('')
        }
    }

    const handleDelete = async (id, name) => {
        if (!confirm(`Xóa ${name}? Hành động này sẽ xóa cả tỷ lệ rơi vật phẩm này.`)) return

        try {
            await pokemonApi.delete(id)
            loadPokemon()
        } catch (err) {
            alert('Xóa thất bại: ' + err.message)
        }
    }

    const toggleExpanded = (id) => {
        setExpandedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    const buildRows = () => {
        return pokemon.flatMap((p) => {
            const forms = Array.isArray(p.forms) && p.forms.length > 0
                ? p.forms
                : [{
                    formId: p.defaultFormId || 'normal',
                    formName: p.defaultFormId || 'normal',
                    imageUrl: p.imageUrl || '',
                }]
            const defaultFormId = p.defaultFormId || forms[0]?.formId || 'normal'
            const defaultForm = forms.find((form) => form.formId === defaultFormId) || forms[0]
            const extraForms = forms.filter((form) => form.formId !== defaultFormId)
            const isExpanded = expandedIds.has(p._id)

            const rows = []

            rows.push(
                <tr key={`${p._id}-base`} className="hover:bg-blue-50 transition-colors">
                    <td className="px-3 py-2 text-slate-500 font-mono text-xs">#{p.pokedexNumber.toString().padStart(3, '0')}</td>
                    <td className="px-3 py-2">
                        {(defaultForm?.imageUrl || p.imageUrl) ? (
                            <img
                                src={defaultForm?.imageUrl || p.imageUrl}
                                alt={p.name}
                                className="w-10 h-10 object-cover rounded border border-slate-200 shadow-sm"
                            />
                        ) : (
                            <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                                ?
                            </div>
                        )}
                    </td>
                    <td className="px-3 py-2 text-slate-800 font-bold text-sm truncate max-w-[140px]" title={p.name}>
                        {p.name}
                    </td>
                    <td className="px-3 py-2">
                        <div className="flex gap-1 flex-wrap max-w-[100px]">
                            {p.types.map(type => (
                                <span
                                    key={type}
                                    className={`px-1.5 py-0.5 rounded-[3px] text-[10px] text-white font-bold uppercase tracking-wide shadow-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`}
                                >
                                    {type.slice(0, 3)}
                                </span>
                            ))}
                        </div>
                    </td>
                    <td className="px-3 py-2">
                        <span
                            className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                            title={defaultForm?.formName ? `${defaultForm.formName} (${defaultForm.formId})` : defaultForm?.formId}
                        >
                            {defaultForm?.formName || defaultForm?.formId}
                        </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                        <div className="flex items-center gap-2">
                            <select
                                value={evolutionEdits[p._id]?.evolvesTo || ''}
                                onChange={(e) => updateEvolutionEdit(p._id, { evolvesTo: e.target.value })}
                                className="w-32 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 truncate"
                            >
                                <option value="">--</option>
                                {allPokemon.map((target) => (
                                    <option key={target._id} value={target._id} disabled={target._id === p._id}>
                                        #{target.pokedexNumber} {target.name}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="number"
                                min="1"
                                placeholder="Lv"
                                value={evolutionEdits[p._id]?.minLevel ?? ''}
                                onChange={(e) => updateEvolutionEdit(p._id, { minLevel: e.target.value })}
                                className="w-12 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-center focus:ring-1 focus:ring-blue-500"
                                disabled={!evolutionEdits[p._id]?.evolvesTo}
                            />
                            <button
                                type="button"
                                onClick={() => handleSaveEvolution(p)}
                                disabled={savingId === p._id}
                                title="Lưu tiến hóa"
                                className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded shadow-sm flex items-center justify-center"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                            </button>
                        </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                            {extraForms.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => toggleExpanded(p._id)}
                                    title={isExpanded ? 'Ẩn dạng' : 'Xem dạng'}
                                    className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded text-xs font-bold shadow-sm"
                                >
                                    {isExpanded ? 'Ẩn dạng' : `Dạng (${extraForms.length})`}
                                </button>
                            )}
                            <Link
                                to={`/admin/pokemon/${p._id}/edit`}
                                title="Sửa"
                                className="p-1.5 bg-green-500 hover:bg-green-600 text-white rounded shadow-sm"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                                </svg>
                            </Link>
                            <button
                                onClick={() => handleDelete(p._id, p.name)}
                                title="Xóa"
                                className="p-1.5 bg-red-500 hover:bg-red-600 text-white rounded shadow-sm"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                            </button>
                        </div>
                    </td>
                </tr>
            )

            if (isExpanded) {
                extraForms.forEach((form) => {
                    rows.push(
                        <tr key={`${p._id}-${form.formId}`} className="bg-slate-50/40">
                            <td className="px-3 py-2 text-slate-400 font-mono text-xs">#{p.pokedexNumber.toString().padStart(3, '0')}</td>
                            <td className="px-3 py-2">
                                {(form.imageUrl || p.imageUrl) ? (
                                    <img
                                        src={form.imageUrl || p.imageUrl}
                                        alt={`${p.name} ${form.formName || form.formId}`.trim()}
                                        className="w-10 h-10 object-cover rounded border border-slate-200 shadow-sm"
                                    />
                                ) : (
                                    <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                                        ?
                                    </div>
                                )}
                            </td>
                            <td className="px-3 py-2 text-slate-700 font-semibold text-sm truncate max-w-[140px]" title={p.name}>
                                {p.name}
                            </td>
                            <td className="px-3 py-2">
                                <div className="flex gap-1 flex-wrap max-w-[100px]">
                                    {p.types.map(type => (
                                        <span
                                            key={type}
                                            className={`px-1.5 py-0.5 rounded-[3px] text-[10px] text-white font-bold uppercase tracking-wide shadow-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`}
                                        >
                                            {type.slice(0, 3)}
                                        </span>
                                    ))}
                                </div>
                            </td>
                            <td className="px-3 py-2">
                                <span
                                    className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                                    title={form.formName ? `${form.formName} (${form.formId})` : form.formId}
                                >
                                    {form.formName || form.formId}
                                </span>
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                                <div className="flex items-center gap-2">
                                    <select
                                        value={evolutionEdits[p._id]?.evolvesTo || ''}
                                        onChange={(e) => updateEvolutionEdit(p._id, { evolvesTo: e.target.value })}
                                        className="w-32 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 truncate"
                                    >
                                        <option value="">--</option>
                                        {allPokemon.map((target) => (
                                            <option key={target._id} value={target._id} disabled={target._id === p._id}>
                                                #{target.pokedexNumber} {target.name}
                                            </option>
                                        ))}
                                    </select>
                                    <input
                                        type="number"
                                        min="1"
                                        placeholder="Lv"
                                        value={evolutionEdits[p._id]?.minLevel ?? ''}
                                        onChange={(e) => updateEvolutionEdit(p._id, { minLevel: e.target.value })}
                                        className="w-12 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-center focus:ring-1 focus:ring-blue-500"
                                        disabled={!evolutionEdits[p._id]?.evolvesTo}
                                    />
                                </div>
                            </td>
                            <td className="px-3 py-2 text-right"></td>
                        </tr>
                    )
                })
            }

            return rows
        })
    }

    return (
        <div className="rounded border border-blue-400 bg-white shadow-sm">
            <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2 flex justify-between items-center">
                <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">Quản Lý Pokemon</h1>
                <Link
                    to="/admin/pokemon/create"
                    className="px-3 py-1 bg-white hover:bg-blue-50 text-blue-700 rounded text-xs font-bold shadow-sm transition-colors"
                >
                    + Thêm Mới
                </Link>
            </div>

            <div className="p-4">
                {/* Filters */}
                <div className="flex gap-3 mb-4 bg-slate-50 p-3 rounded border border-slate-200">
                    <input
                        type="text"
                        placeholder="Tìm theo tên..."
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 w-64 focus:outline-none focus:border-blue-500 shadow-sm"
                    />
                    <select
                        value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-800 focus:outline-none focus:border-blue-500 shadow-sm"
                    >
                        <option value="">Tất cả hệ</option>
                        {Object.keys(TYPE_COLORS).map(type => (
                            <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>
                        ))}
                    </select>
                </div>

                {error && <div className="p-3 mb-4 bg-red-50 text-red-700 border border-red-200 rounded text-sm">{error}</div>}

                {loading ? (
                    <div className="text-center py-8 text-blue-800 font-medium">Đang tải dữ liệu...</div>
                ) : (
                    <>
                        {/* Table */}
                        <div
                            ref={topScrollRef}
                            className="bg-slate-50 border border-slate-200 border-b-0 rounded-t-lg overflow-x-auto shadow-sm h-4 mb-[-1px] sticky-top-scrollbar"
                            style={{ scrollbarWidth: 'thin' }}
                        >
                            <div style={{ width: '1200px' }} className="h-full"></div>
                        </div>
                        <div
                            ref={tableContainerRef}
                            className="bg-white border border-slate-200 rounded-b-lg overflow-auto shadow-sm rounded-t-none max-h-[70vh] custom-scrollbar"
                        >
                            <table className="w-full text-sm min-w-[1200px]">
                                <thead className="bg-blue-600 text-white border-b border-blue-700 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs w-14 whitespace-nowrap">#</th>
                                        <th className="px-3 py-3 text-center font-bold uppercase text-xs w-20 whitespace-nowrap">Hình</th>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs min-w-[150px] whitespace-nowrap">Tên</th>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs min-w-[280px] whitespace-nowrap">Tiến Hóa</th>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs w-32 whitespace-nowrap">Hệ</th>
                                        <th className="px-3 py-3 text-left font-bold uppercase text-xs w-28 whitespace-nowrap">Dạng</th>
                                        <th className="px-3 py-3 text-right font-bold uppercase text-xs w-28 whitespace-nowrap">Hành Động</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {pokemon.map((p) => {
                                        const forms = Array.isArray(p.forms) && p.forms.length > 0
                                            ? p.forms
                                            : [{
                                                formId: p.defaultFormId || 'normal',
                                                formName: p.defaultFormId || 'normal',
                                                imageUrl: p.imageUrl || '',
                                            }]
                                        const defaultFormId = p.defaultFormId || forms[0]?.formId || 'normal'
                                        const defaultForm = forms.find((form) => form.formId === defaultFormId) || forms[0]
                                        const extraForms = forms.filter((form) => form.formId !== defaultFormId)
                                        const isExpanded = expandedIds.has(p._id)

                                        return (
                                            <React.Fragment key={p._id}>
                                                <tr className="hover:bg-blue-50/30 transition-colors border-b border-slate-100 last:border-0">
                                                    <td className="px-3 py-3 text-slate-500 font-mono text-xs">#{p.pokedexNumber.toString().padStart(3, '0')}</td>
                                                    <td className="px-3 py-3 text-center">
                                                        {(defaultForm?.imageUrl || p.imageUrl) ? (
                                                            <img
                                                                src={defaultForm?.imageUrl || p.imageUrl}
                                                                alt={p.name}
                                                                className="w-10 h-10 object-cover rounded border border-slate-200 shadow-sm mx-auto"
                                                            />
                                                        ) : (
                                                            <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs mx-auto">
                                                                ?
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-3 text-slate-800 font-bold text-sm truncate max-w-[150px]" title={p.name}>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="truncate">{p.name}</span>
                                                            {extraForms.length > 0 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleExpanded(p._id)}
                                                                    title={isExpanded ? 'Ẩn dạng' : 'Xem dạng'}
                                                                    className={`px-1.5 py-0.5 border text-[10px] rounded font-bold shadow-sm transition-colors flex items-center gap-1 shrink-0 ${isExpanded ? 'bg-slate-100 text-slate-600 border-slate-300' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}`}
                                                                >
                                                                    {isExpanded ? (
                                                                        <>
                                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                                                <path fillRule="evenodd" d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z" clipRule="evenodd" />
                                                                            </svg>
                                                                            Ẩn
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                                                                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01-.02-1.06z" clipRule="evenodd" />
                                                                            </svg>
                                                                            +{extraForms.length}
                                                                        </>
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-slate-600">
                                                        <div className="flex items-center gap-2">
                                                            <select
                                                                value={evolutionEdits[p._id]?.evolvesTo || ''}
                                                                onChange={(e) => updateEvolutionEdit(p._id, { evolvesTo: e.target.value })}
                                                                className="w-36 px-2 py-1 bg-white border border-slate-300 rounded text-xs focus:ring-1 focus:ring-blue-500 truncate"
                                                            >
                                                                <option value="">--</option>
                                                                {allPokemon.map((target) => (
                                                                    <option key={target._id} value={target._id} disabled={target._id === p._id}>
                                                                        #{target.pokedexNumber} {target.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                placeholder="Lv"
                                                                value={evolutionEdits[p._id]?.minLevel ?? ''}
                                                                onChange={(e) => updateEvolutionEdit(p._id, { minLevel: e.target.value })}
                                                                className="w-12 px-2 py-1 bg-white border border-slate-300 rounded text-xs text-center focus:ring-1 focus:ring-blue-500"
                                                                disabled={!evolutionEdits[p._id]?.evolvesTo}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSaveEvolution(p)}
                                                                disabled={savingId === p._id}
                                                                title="Lưu tiến hóa"
                                                                className="p-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded shadow-sm flex items-center justify-center transition-colors"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <div className="flex gap-1 flex-wrap max-w-[120px]">
                                                            {p.types.map(type => (
                                                                <span
                                                                    key={type}
                                                                    className={`px-1.5 py-0.5 rounded-[3px] text-[10px] text-white font-bold uppercase tracking-wide shadow-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`}
                                                                >
                                                                    {type.slice(0, 3)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <span
                                                            className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200"
                                                            title={defaultForm?.formName ? `${defaultForm.formName} (${defaultForm.formId})` : defaultForm?.formId}
                                                        >
                                                            {defaultForm?.formName || defaultForm?.formId}
                                                        </span>
                                                    </td>

                                                    <td className="px-3 py-3 text-right whitespace-nowrap">
                                                        <div className="flex justify-end gap-1">
                                                            <Link
                                                                to={`/admin/pokemon/${p._id}/edit`}
                                                                title="Sửa"
                                                                className="p-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded shadow-sm transition-colors"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                                                                </svg>
                                                            </Link>
                                                            <button
                                                                onClick={() => handleDelete(p._id, p.name)}
                                                                title="Xóa"
                                                                className="p-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded shadow-sm transition-colors"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && extraForms.map((form) => (
                                                    <tr key={`${p._id}-${form.formId}`} className="bg-slate-50/60">
                                                        <td className="px-3 py-3 text-slate-400 font-mono text-xs border-t border-slate-100/50">
                                                            <div className="flex justify-end pr-2">↳</div>
                                                        </td>
                                                        <td className="px-3 py-3 text-center border-t border-slate-100/50">
                                                            {(form.imageUrl || p.imageUrl) ? (
                                                                <img
                                                                    src={form.imageUrl || p.imageUrl}
                                                                    alt={`${p.name} ${form.formName || form.formId}`.trim()}
                                                                    className="w-10 h-10 object-cover rounded border border-slate-200 shadow-sm mx-auto opacity-90"
                                                                />
                                                            ) : (
                                                                <div className="w-10 h-10 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-slate-400 text-xs mx-auto">
                                                                    ?
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-3 text-slate-600 font-medium text-sm truncate max-w-[200px] border-t border-slate-100/50">
                                                            {p.name} <span className="text-xs text-slate-400 italic">({form.formName || form.formId})</span>
                                                        </td>
                                                        <td className="px-3 py-3 border-t border-slate-100/50">
                                                            <div className="flex gap-1 flex-wrap max-w-[120px] opacity-60">
                                                                {p.types.map(type => (
                                                                    <span
                                                                        key={type}
                                                                        className={`px-1.5 py-0.5 rounded-[3px] text-[10px] text-white font-bold uppercase tracking-wide shadow-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`}
                                                                    >
                                                                        {type.slice(0, 3)}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3 border-t border-slate-100/50">
                                                            <span
                                                                className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 border border-blue-200"
                                                            >
                                                                {form.formName || form.formId}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-3 text-right whitespace-nowrap border-t border-slate-100/50"></td>
                                                    </tr>
                                                ))}
                                            </React.Fragment>
                                        )
                                    })}
                                    {pokemon.length === 0 && (
                                        <tr>
                                            <td colSpan="7" className="px-4 py-8 text-center text-slate-500 italic">
                                                Không tìm thấy Pokemon nào.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {pagination.pages > 1 && (
                            <div className="flex justify-between items-center mt-4 text-slate-600 text-xs font-medium">
                                <div className="bg-slate-100 px-3 py-1 rounded border border-slate-200">
                                    Tổng <span className="font-bold">{pagination.total}</span> bản ghi &bull; Trang <span className="font-bold text-blue-700">{page}</span>/{pagination.pages}
                                </div>
                                <div className="flex gap-1">
                                    <button
                                        disabled={page === 1}
                                        onClick={() => setPage(page - 1)}
                                        className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs text-slate-700 font-bold shadow-sm"
                                    >
                                        &laquo;
                                    </button>

                                    {(() => {
                                        const totalPages = pagination.pages
                                        const delta = 2
                                        const range = []
                                        const rangeWithDots = []
                                        let l

                                        for (let i = 1; i <= totalPages; i++) {
                                            if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
                                                range.push(i)
                                            }
                                        }

                                        for (let i of range) {
                                            if (l) {
                                                if (i - l === 2) {
                                                    rangeWithDots.push(l + 1)
                                                } else if (i - l !== 1) {
                                                    rangeWithDots.push('...')
                                                }
                                            }
                                            rangeWithDots.push(i)
                                            l = i
                                        }

                                        return rangeWithDots.map((pageNum, index) => (
                                            pageNum === '...' ? (
                                                <span key={`dots-${index}`} className="px-2 py-1 text-slate-400">...</span>
                                            ) : (
                                                <button
                                                    key={pageNum}
                                                    onClick={() => setPage(pageNum)}
                                                    className={`min-w-[32px] px-2 py-1 border rounded text-xs font-bold transition-colors shadow-sm ${page === pageNum
                                                        ? 'bg-blue-600 border-blue-600 text-white'
                                                        : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'
                                                        }`}
                                                >
                                                    {pageNum}
                                                </button>
                                            )
                                        ))
                                    })()}

                                    <button
                                        disabled={page >= pagination.pages}
                                        onClick={() => setPage(page + 1)}
                                        className="px-2 py-1 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs text-slate-700 font-bold shadow-sm"
                                    >
                                        &raquo;
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
