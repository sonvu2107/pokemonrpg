import { useEffect, useMemo, useState } from 'react'
import { gameApi } from '../services/gameApi'
import { useToast } from '../context/ToastContext'

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm">
        {title}
    </div>
)

const TYPE_LABELS = {
    normal: 'Normal',
    fire: 'Fire',
    water: 'Water',
    grass: 'Grass',
    electric: 'Electric',
    ice: 'Ice',
    fighting: 'Fighting',
    poison: 'Poison',
    ground: 'Ground',
    flying: 'Flying',
    psychic: 'Psychic',
    bug: 'Bug',
    rock: 'Rock',
    ghost: 'Ghost',
    dragon: 'Dragon',
    dark: 'Dark',
    steel: 'Steel',
    fairy: 'Fairy',
}

const TYPE_FILTER_OPTIONS = ['all', ...Object.keys(TYPE_LABELS)]

const CATEGORY_LABELS = {
    physical: 'Physical',
    special: 'Special',
    status: 'Status',
}

const RARITY_LABELS = {
    common: 'Common',
    uncommon: 'Uncommon',
    rare: 'Rare',
    epic: 'Epic',
    legendary: 'Legendary',
}

const POKEMON_RARITY_LABELS = {
    'sss+': 'SSS+',
    sss: 'SSS',
    ss: 'SS',
    s: 'S',
    a: 'A',
    b: 'B',
    c: 'C',
    d: 'D',
}

const describeLearnScope = (skill) => {
    const scope = String(skill?.learnScope || 'all').toLowerCase()
    if (scope === 'move_type') {
        return 'Chỉ Pokemon cùng hệ với kỹ năng mới học được'
    }
    if (scope === 'type') {
        const types = Array.isArray(skill?.allowedTypes) ? skill.allowedTypes : []
        return types.length > 0
            ? `Dùng cho hệ: ${types.map((entry) => TYPE_LABELS[entry] || entry).join(', ')}`
            : 'Dùng theo hệ Pokemon'
    }
    if (scope === 'rarity') {
        const rarities = Array.isArray(skill?.allowedRarities) ? skill.allowedRarities : []
        return rarities.length > 0
            ? `Dùng cho độ hiếm: ${rarities.map((entry) => POKEMON_RARITY_LABELS[entry] || entry).join(', ')}`
            : 'Dùng theo độ hiếm Pokemon'
    }
    if (scope === 'species') {
        return 'Chỉ Pokemon đặc biệt mới dùng được'
    }
    return 'Mọi Pokemon đều có thể học'
}

const getFallbackMoveImage = () => 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/tm-normal.png'

export default function SkillShopPage() {
    const [skills, setSkills] = useState([])
    const [wallet, setWallet] = useState({ platinumCoins: 0, moonPoints: 0 })
    const toast = useToast()
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, limit: 20, total: 0 })
    const [typeFilter, setTypeFilter] = useState('all')
    const [categoryFilter, setCategoryFilter] = useState('all')
    const [rarityFilter, setRarityFilter] = useState('all')
    const [searchKeyword, setSearchKeyword] = useState('')
    const [sortBy, setSortBy] = useState('price_asc')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [buyingMoveId, setBuyingMoveId] = useState('')
    const [buyQuantity, setBuyQuantity] = useState(1)

    useEffect(() => {
        loadSkills(1, {
            type: typeFilter,
            category: categoryFilter,
            rarity: rarityFilter,
            search: searchKeyword,
            sort: sortBy,
        })
    }, [typeFilter, categoryFilter, rarityFilter, searchKeyword, sortBy])

    const availableTypes = useMemo(() => {
        const dynamicTypes = [...new Set(
            skills
                .map((skill) => String(skill?.type || '').trim().toLowerCase())
                .filter(Boolean)
                .filter((entry) => !TYPE_FILTER_OPTIONS.includes(entry))
        )]
        return [...TYPE_FILTER_OPTIONS, ...dynamicTypes]
    }, [skills])

    const availableCategories = useMemo(() => {
        const dynamicCategories = [...new Set(skills.map((skill) => skill.category).filter(Boolean))]
        return ['all', ...dynamicCategories]
    }, [skills])

    const availableRarities = useMemo(() => {
        const dynamicRarities = [...new Set(skills.map((skill) => skill.rarity).filter(Boolean))]
        return ['all', ...dynamicRarities]
    }, [skills])

    const loadSkills = async (page, filters) => {
        try {
            setLoading(true)
            setError('')

            const params = {
                page,
                limit: pagination.limit,
            }

            if (filters.type && filters.type !== 'all') {
                params.type = filters.type
            }
            if (filters.category && filters.category !== 'all') {
                params.category = filters.category
            }
            if (filters.rarity && filters.rarity !== 'all') {
                params.rarity = filters.rarity
            }
            if (filters.search) {
                params.search = filters.search
            }
            if (filters.sort) {
                params.sort = filters.sort
            }

            const data = await gameApi.getShopSkills(params)
            setSkills(data.skills || [])
            setWallet({
                platinumCoins: Number(data?.wallet?.platinumCoins ?? 0),
                moonPoints: Number(data?.wallet?.moonPoints || 0),
            })
            setPagination((prev) => ({
                ...prev,
                ...(data.pagination || {}),
            }))
        } catch (err) {
            setError(err.message || 'Không thể tải cửa hàng kỹ năng')
            setSkills([])
        } finally {
            setLoading(false)
        }
    }

    const handlePageChange = async (page) => {
        if (page < 1 || page > (pagination.totalPages || 1)) return
        await loadSkills(page, {
            type: typeFilter,
            category: categoryFilter,
            rarity: rarityFilter,
            search: searchKeyword,
            sort: sortBy,
        })
    }

    const handleBuy = async (skill) => {
        const quantity = Math.max(1, Number(buyQuantity) || 1)
        try {
            setBuyingMoveId(skill._id)
            const result = await gameApi.buyShopSkill(skill._id, quantity)
            setWallet({
                platinumCoins: Number(result?.wallet?.platinumCoins ?? wallet.platinumCoins),
                moonPoints: Number(result?.wallet?.moonPoints || wallet.moonPoints),
            })
            toast.showSuccess(result?.message || 'Mua kỹ năng thành công')
        } catch (err) {
            toast.showError(err.message || 'Mua kỹ năng thất bại')
        } finally {
            setBuyingMoveId('')
        }
    }

    return (
        <div className="max-w-5xl mx-auto pb-12 font-sans">
            <div className="text-center mb-6">
                <div className="text-slate-700 text-sm font-bold flex justify-center gap-4 mb-1">
                    <span className="flex items-center gap-1">🪙 {wallet.platinumCoins.toLocaleString('vi-VN')} Xu Bạch Kim</span>
                    <span className="flex items-center gap-1 text-purple-700">🌑 {wallet.moonPoints.toLocaleString('vi-VN')} Điểm Nguyệt Các</span>
                </div>
                <h1 className="text-3xl font-bold text-blue-900 drop-shadow-sm">Cửa Hàng Kỹ Năng</h1>
            </div>
            <div className="space-y-4">
                <section className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Cửa hàng kỹ năng" />
                    <div className="bg-blue-100/50 border-b border-blue-200 p-3 md:p-4 flex flex-col gap-3 md:gap-4">
                        <div className="flex items-center gap-2 w-full">
                            <label className="text-xs font-bold text-blue-800 uppercase tracking-wide whitespace-nowrap flex-shrink-0 w-16 sm:w-auto sm:min-w-[56px]">Tên</label>
                            <input
                                type="text"
                                value={searchKeyword}
                                onChange={(e) => setSearchKeyword(e.target.value)}
                                placeholder="Nhập tên kỹ năng..."
                                className="flex-1 w-full min-w-0 px-3 py-2 bg-white border border-slate-300 hover:border-blue-400 rounded-md text-sm text-slate-700 font-medium shadow-sm transition-all outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex flex-wrap gap-3 md:gap-4 items-center">
                            <div className="flex items-center gap-2 flex-1 min-w-[120px] sm:min-w-[150px]">
                                <label className="text-xs font-bold text-blue-800 uppercase tracking-wide whitespace-nowrap flex-shrink-0">Hệ</label>
                                <select
                                    value={typeFilter}
                                    onChange={(e) => setTypeFilter(e.target.value)}
                                    className="flex-1 w-full min-w-0 px-3 py-2 bg-white border border-slate-300 hover:border-blue-400 rounded-md text-sm text-slate-700 font-medium shadow-sm cursor-pointer transition-all outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    {availableTypes.map((type) => (
                                        <option key={type} value={type}>{type === 'all' ? 'Tất cả hệ' : (TYPE_LABELS[type] || type)}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-2 flex-1 min-w-[120px] sm:min-w-[150px]">
                                <label className="text-xs font-bold text-blue-800 uppercase tracking-wide whitespace-nowrap flex-shrink-0">Nhóm</label>
                                <select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className="flex-1 w-full min-w-0 px-3 py-2 bg-white border border-slate-300 hover:border-blue-400 rounded-md text-sm text-slate-700 font-medium shadow-sm cursor-pointer transition-all outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    {availableCategories.map((category) => (
                                        <option key={category} value={category}>{category === 'all' ? 'Tất cả nhóm' : (CATEGORY_LABELS[category] || category)}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-2 flex-1 min-w-[120px] sm:min-w-[150px]">
                                <label className="text-xs font-bold text-blue-800 uppercase tracking-wide whitespace-nowrap flex-shrink-0">Độ hiếm</label>
                                <select
                                    value={rarityFilter}
                                    onChange={(e) => setRarityFilter(e.target.value)}
                                    className="flex-1 w-full min-w-0 px-3 py-2 bg-white border border-slate-300 hover:border-blue-400 rounded-md text-sm text-slate-700 font-medium shadow-sm cursor-pointer transition-all outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    {availableRarities.map((rarity) => (
                                        <option key={rarity} value={rarity}>{rarity === 'all' ? 'Tất cả độ hiếm' : (RARITY_LABELS[rarity] || rarity)}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-2 flex-1 min-w-[120px] sm:min-w-[150px]">
                                <label className="text-xs font-bold text-blue-800 uppercase tracking-wide whitespace-nowrap flex-shrink-0">Số lượng</label>
                                <select
                                    value={buyQuantity}
                                    onChange={(e) => setBuyQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                    className="flex-1 w-full min-w-0 px-3 py-2 bg-white border border-slate-300 hover:border-blue-400 rounded-md text-sm text-slate-700 font-medium shadow-sm cursor-pointer transition-all outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    <option value={1}>x1</option>
                                    <option value={5}>x5</option>
                                    <option value={10}>x10</option>
                                    <option value={20}>x20</option>
                                </select>
                            </div>

                            <div className="flex items-center gap-2 flex-1 min-w-[120px] sm:min-w-[150px]">
                                <label className="text-xs font-bold text-blue-800 uppercase tracking-wide whitespace-nowrap flex-shrink-0">Sắp xếp</label>
                                <select
                                    value={sortBy}
                                    onChange={(e) => setSortBy(e.target.value)}
                                    className="flex-1 w-full min-w-0 px-3 py-2 bg-white border border-slate-300 hover:border-blue-400 rounded-md text-sm text-slate-700 font-medium shadow-sm cursor-pointer transition-all outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                >
                                    <option value="price_asc">Giá tăng</option>
                                    <option value="price_desc">Giá giảm</option>
                                    <option value="type_asc">Hệ A-Z</option>
                                    <option value="type_desc">Hệ Z-A</option>
                                    <option value="name_asc">Tên A-Z</option>
                                    <option value="name_desc">Tên Z-A</option>
                                    <option value="rarity_asc">Mức hiếm ⬆</option>
                                    <option value="rarity_desc">Mức hiếm ⬇</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-hidden p-2 sm:p-0">
                        <table className="w-full">
                            <thead className="hidden sm:table-header-group">
                                <tr className="bg-blue-50 border-b border-blue-300 text-blue-900 text-sm font-bold">
                                    <th className="px-3 py-3 text-center border-r border-blue-200 w-24">Hình</th>
                                    <th className="px-3 py-3 text-center border-r border-blue-200">Kỹ năng</th>
                                    <th className="px-3 py-3 text-center border-r border-blue-200 w-64">Thông số</th>
                                    <th className="px-3 py-3 text-center border-r border-blue-200 w-40">Giá</th>
                                    <th className="px-3 py-3 text-center w-28">Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="px-3 py-10 text-center text-slate-500 font-bold">Đang tải cửa hàng kỹ năng...</td>
                                    </tr>
                                ) : error ? (
                                    <tr>
                                        <td colSpan={5} className="px-3 py-10 text-center text-red-600 font-bold">{error}</td>
                                    </tr>
                                ) : skills.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-3 py-10 text-center text-slate-500">Chưa có kỹ năng nào đang bán.</td>
                                    </tr>
                                ) : (
                                    skills.map((skill) => (
                                        <tr key={skill._id} className="flex flex-col sm:table-row bg-white border border-blue-200 mb-3 sm:mb-0 sm:border-0 sm:border-b sm:border-blue-100 rounded-lg sm:rounded-none overflow-hidden shadow-sm sm:shadow-none">
                                            <td className="sm:table-cell px-3 py-3 sm:border-r border-blue-100 align-middle hidden sm:table-cell text-center">
                                                <img
                                                    src={skill.imageUrl || getFallbackMoveImage()}
                                                    alt={skill.name}
                                                    className="w-16 h-16 sm:w-12 sm:h-12 object-contain mx-auto pixelated drop-shadow-sm"
                                                    onError={(event) => {
                                                        event.currentTarget.onerror = null
                                                        event.currentTarget.src = getFallbackMoveImage()
                                                    }}
                                                />
                                            </td>
                                            <td className="block sm:table-cell p-3 sm:px-3 sm:py-3 sm:border-r border-blue-100 align-middle relative border-b sm:border-b-0 border-slate-100 bg-slate-50/50 sm:bg-transparent text-left sm:text-center">
                                                <div className="flex sm:hidden gap-3 mb-2 items-center">
                                                    <img
                                                        src={skill.imageUrl || getFallbackMoveImage()}
                                                        alt={skill.name}
                                                        className="w-12 h-12 object-contain pixelated drop-shadow-sm"
                                                        onError={(event) => {
                                                            event.currentTarget.onerror = null
                                                            event.currentTarget.src = getFallbackMoveImage()
                                                        }}
                                                    />
                                                    <div>
                                                        <div className="font-bold text-blue-900 text-lg sm:text-lg leading-tight">{skill.name}</div>
                                                        <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5 font-medium flex flex-wrap gap-1 items-center">
                                                            <span className="px-1.5 py-0.5 bg-slate-200 rounded text-slate-700">{TYPE_LABELS[skill.type] || skill.type}</span>
                                                            <span className="px-1.5 py-0.5 bg-slate-200 rounded text-slate-700">{CATEGORY_LABELS[skill.category] || skill.category}</span>
                                                            <span className="px-1.5 py-0.5 bg-slate-200 rounded text-slate-700">{RARITY_LABELS[skill.rarity] || skill.rarity}</span>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="hidden sm:block">
                                                    <div className="font-bold text-slate-800 text-lg leading-tight">{skill.name}</div>
                                                    <div className="text-xs text-slate-500 mt-1 font-medium">
                                                        <span>{TYPE_LABELS[skill.type] || skill.type}</span>
                                                        <span className="mx-1">•</span>
                                                        <span>{CATEGORY_LABELS[skill.category] || skill.category}</span>
                                                        <span className="mx-1">•</span>
                                                        <span>{RARITY_LABELS[skill.rarity] || skill.rarity}</span>
                                                    </div>
                                                </div>

                                                <div className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-relaxed">{skill.description || 'Không có mô tả.'}</div>
                                                <div className="text-[11px] sm:text-xs text-amber-700 font-bold mt-1.5 bg-amber-50 inline-block px-2 py-0.5 rounded border border-amber-200">{describeLearnScope(skill)}</div>
                                            </td>

                                            <td className="block sm:table-cell px-3 py-3 sm:border-r border-blue-100 align-middle">
                                                <div className="grid grid-cols-4 sm:grid-cols-2 gap-2 text-slate-700 text-xs sm:text-sm text-center">
                                                    <div className="bg-slate-100 rounded px-1 py-1.5 flex flex-col justify-center">
                                                        <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Power</span>
                                                        <strong className="text-blue-700 text-sm sm:text-base">{skill.power ?? '--'}</strong>
                                                    </div>
                                                    <div className="bg-slate-100 rounded px-1 py-1.5 flex flex-col justify-center">
                                                        <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Acc</span>
                                                        <strong className="text-emerald-600 text-sm sm:text-base">{skill.accuracy ?? '--'}</strong>
                                                    </div>
                                                    <div className="bg-slate-100 rounded px-1 py-1.5 flex flex-col justify-center">
                                                        <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">PP</span>
                                                        <strong className="text-purple-700 text-sm sm:text-base">{skill.pp ?? '--'}</strong>
                                                    </div>
                                                    <div className="bg-slate-100 rounded px-1 py-1.5 flex flex-col justify-center">
                                                        <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">Priority</span>
                                                        <strong className="text-slate-800 text-sm sm:text-base">{skill.priority ?? 0}</strong>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="flex justify-between items-center sm:table-cell p-3 sm:py-3 sm:border-r border-blue-100 bg-blue-50/50 sm:bg-transparent border-t sm:border-t-0 align-middle text-center">
                                                <div className="text-left sm:text-center">
                                                    <div className="font-bold text-lg sm:text-xl text-amber-600 drop-shadow-sm">{Number(skill.shopPrice || 0).toLocaleString('vi-VN')} </div>
                                                    <div className="text-[10px] sm:text-xs text-slate-500 uppercase font-bold tracking-wide">Xu Bạch Kim</div>
                                                </div>

                                                <div className="sm:hidden">
                                                    <button
                                                        onClick={() => handleBuy(skill)}
                                                        disabled={buyingMoveId === skill._id}
                                                        className="px-6 py-2 bg-gradient-to-r from-blue-600 to-blue-500 border border-blue-700 text-white font-bold rounded-md shadow-sm active:translate-y-px hover:from-blue-700 hover:to-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase text-xs tracking-wider"
                                                    >
                                                        {buyingMoveId === skill._id ? 'Đang mua...' : 'Mua'}
                                                    </button>
                                                </div>
                                            </td>

                                            <td className="hidden sm:table-cell px-3 py-3 text-center align-middle">
                                                <button
                                                    onClick={() => handleBuy(skill)}
                                                    disabled={buyingMoveId === skill._id}
                                                    className="w-full px-3 py-2 bg-white border-2 border-blue-500 text-blue-700 font-bold rounded-md hover:bg-blue-50 hover:text-blue-800 transition-colors shadow-sm active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                                >
                                                    {buyingMoveId === skill._id ? 'Đang mua...' : 'Mua'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {pagination.totalPages > 1 && (
                        <div className="bg-slate-50 border-t border-blue-200 p-2 flex justify-center gap-1 flex-wrap">
                            {Array.from({ length: pagination.totalPages }, (_, idx) => idx + 1).map((pageNum) => (
                                <button
                                    key={pageNum}
                                    onClick={() => handlePageChange(pageNum)}
                                    className={`w-8 h-8 text-xs font-bold rounded border ${pageNum === pagination.page
                                        ? 'bg-blue-600 text-white border-blue-700'
                                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                        }`}
                                >
                                    {pageNum}
                                </button>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}
