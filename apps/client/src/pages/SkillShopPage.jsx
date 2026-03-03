import { useEffect, useMemo, useState } from 'react'
import { gameApi } from '../services/gameApi'

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

const CATEGORY_LABELS = {
    physical: 'Vật lý',
    special: 'Đặc biệt',
    status: 'Trạng thái',
}

const RARITY_LABELS = {
    common: 'Phổ biến',
    uncommon: 'Ít gặp',
    rare: 'Hiếm',
    epic: 'Sử thi',
    legendary: 'Huyền thoại',
}

const POKEMON_RARITY_LABELS = {
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
    const [wallet, setWallet] = useState({ gold: 0, moonPoints: 0 })
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1, limit: 20, total: 0 })
    const [typeFilter, setTypeFilter] = useState('all')
    const [categoryFilter, setCategoryFilter] = useState('all')
    const [rarityFilter, setRarityFilter] = useState('all')
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
            sort: sortBy,
        })
    }, [typeFilter, categoryFilter, rarityFilter, sortBy])

    const availableTypes = useMemo(() => {
        const dynamicTypes = [...new Set(skills.map((skill) => skill.type).filter(Boolean))]
        return ['all', ...dynamicTypes]
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
            if (filters.sort) {
                params.sort = filters.sort
            }

            const data = await gameApi.getShopSkills(params)
            setSkills(data.skills || [])
            setWallet({
                gold: Number(data?.wallet?.gold || 0),
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
            sort: sortBy,
        })
    }

    const handleBuy = async (skill) => {
        const quantity = Math.max(1, Number(buyQuantity) || 1)
        try {
            setBuyingMoveId(skill._id)
            const result = await gameApi.buyShopSkill(skill._id, quantity)
            setWallet({
                gold: Number(result?.wallet?.gold || wallet.gold),
                moonPoints: Number(result?.wallet?.moonPoints || wallet.moonPoints),
            })
            window.alert(result?.message || 'Mua kỹ năng thành công')
        } catch (err) {
            window.alert(err.message || 'Mua kỹ năng thất bại')
        } finally {
            setBuyingMoveId('')
        }
    }

    return (
        <div className="max-w-5xl mx-auto pb-12 font-sans">
            <div className="text-center mb-6">
                <div className="text-slate-700 text-sm font-bold flex justify-center gap-4 mb-1">
                    <span className="flex items-center gap-1">🪙 {wallet.gold.toLocaleString('vi-VN')} Xu Bạch Kim</span>
                    <span className="flex items-center gap-1 text-purple-700">🌙 {wallet.moonPoints.toLocaleString('vi-VN')} Điểm Nguyệt</span>
                </div>
                <h1 className="text-3xl font-bold text-blue-900 drop-shadow-sm">Cửa Hàng Kỹ Năng</h1>
            </div>

            <div className="space-y-4">
                <section className="border border-blue-400 rounded-t-lg overflow-hidden shadow-sm bg-white">
                    <SectionHeader title="Skill Shop" />

                    <div className="bg-blue-100/50 border-b border-blue-200 p-3 md:p-4 grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-5 gap-3 md:gap-4">
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-blue-800 uppercase whitespace-nowrap flex-shrink-0 w-16 sm:w-auto sm:min-w-[64px]">Hệ</label>
                            <select
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-700 font-medium cursor-pointer"
                            >
                                {availableTypes.map((type) => (
                                    <option key={type} value={type}>{type === 'all' ? 'Tất cả hệ' : (TYPE_LABELS[type] || type)}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-blue-800 uppercase whitespace-nowrap flex-shrink-0 w-16 sm:w-auto sm:min-w-[70px]">Nhóm</label>
                            <select
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-700 font-medium cursor-pointer"
                            >
                                {availableCategories.map((category) => (
                                    <option key={category} value={category}>{category === 'all' ? 'Tất cả nhóm' : (CATEGORY_LABELS[category] || category)}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-blue-800 uppercase whitespace-nowrap flex-shrink-0 w-16 sm:w-auto sm:min-w-[70px]">Độ hiếm</label>
                            <select
                                value={rarityFilter}
                                onChange={(e) => setRarityFilter(e.target.value)}
                                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-700 font-medium cursor-pointer"
                            >
                                {availableRarities.map((rarity) => (
                                    <option key={rarity} value={rarity}>{rarity === 'all' ? 'Tất cả độ hiếm' : (RARITY_LABELS[rarity] || rarity)}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-blue-800 uppercase whitespace-nowrap flex-shrink-0 w-16 sm:w-auto sm:min-w-[70px]">Số lượng</label>
                            <select
                                value={buyQuantity}
                                onChange={(e) => setBuyQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-700 font-medium cursor-pointer"
                            >
                                <option value={1}>x1</option>
                                <option value={5}>x5</option>
                                <option value={10}>x10</option>
                                <option value={20}>x20</option>
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-blue-800 uppercase whitespace-nowrap flex-shrink-0 w-16 sm:w-auto sm:min-w-[55px]">Sắp xếp</label>
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value)}
                                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-300 rounded text-sm text-slate-700 font-medium cursor-pointer"
                            >
                                <option value="price_asc">Giá tăng dần</option>
                                <option value="price_desc">Giá giảm dần</option>
                                <option value="type_asc">Hệ A-Z</option>
                                <option value="type_desc">Hệ Z-A</option>
                                <option value="name_asc">Tên A-Z</option>
                                <option value="name_desc">Tên Z-A</option>
                                <option value="rarity_asc">Độ hiếm tăng</option>
                                <option value="rarity_desc">Độ hiếm giảm</option>
                            </select>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px]">
                            <thead>
                                <tr className="bg-blue-50 border-b border-blue-300 text-blue-900 text-sm font-bold">
                                    <th className="px-3 py-2 text-center border-r border-blue-200 w-24">Hình</th>
                                    <th className="px-3 py-2 text-center border-r border-blue-200">Kỹ năng</th>
                                    <th className="px-3 py-2 text-center border-r border-blue-200 w-64">Thông số</th>
                                    <th className="px-3 py-2 text-center border-r border-blue-200 w-52">Giá</th>
                                    <th className="px-3 py-2 text-center w-28">Mua</th>
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
                                        <tr key={skill._id} className="border-b border-blue-100 hover:bg-blue-50/40">
                                            <td className="px-3 py-3 border-r border-blue-100 text-center">
                                                <img
                                                    src={skill.imageUrl || getFallbackMoveImage()}
                                                    alt={skill.name}
                                                    className="w-10 h-10 object-contain mx-auto pixelated"
                                                    onError={(event) => {
                                                        event.currentTarget.onerror = null
                                                        event.currentTarget.src = getFallbackMoveImage()
                                                    }}
                                                />
                                            </td>
                                            <td className="px-3 py-3 border-r border-blue-100 text-center">
                                                <div className="font-bold text-slate-800 text-lg">{skill.name}</div>
                                                <div className="text-xs text-slate-500 mt-1">
                                                    <span className="font-semibold">{TYPE_LABELS[skill.type] || skill.type}</span>
                                                    {' • '}
                                                    <span>{CATEGORY_LABELS[skill.category] || skill.category}</span>
                                                    {' • '}
                                                    <span>{RARITY_LABELS[skill.rarity] || skill.rarity}</span>
                                                </div>
                                                <div className="text-sm italic text-slate-600 mt-1">{skill.description || 'Không có mô tả.'}</div>
                                                <div className="text-xs text-amber-700 font-semibold mt-1">{describeLearnScope(skill)}</div>
                                            </td>
                                            <td className="px-3 py-3 border-r border-blue-100 text-center text-sm">
                                                <div className="grid grid-cols-2 gap-2 text-slate-700">
                                                    <div className="bg-slate-100 rounded px-2 py-1">Power: <strong>{skill.power ?? '--'}</strong></div>
                                                    <div className="bg-slate-100 rounded px-2 py-1">Acc: <strong>{skill.accuracy ?? '--'}</strong></div>
                                                    <div className="bg-slate-100 rounded px-2 py-1">PP: <strong>{skill.pp ?? '--'}</strong></div>
                                                    <div className="bg-slate-100 rounded px-2 py-1">Priority: <strong>{skill.priority ?? 0}</strong></div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 border-r border-blue-100 text-center">
                                                <div className="font-bold text-xl text-slate-900">{Number(skill.shopPrice || 0).toLocaleString('vi-VN')} xu</div>
                                                <div className="text-sm text-slate-500">Xu Bạch Kim</div>
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <button
                                                    onClick={() => handleBuy(skill)}
                                                    disabled={buyingMoveId === skill._id}
                                                    className="px-3 py-1.5 bg-white border border-blue-400 text-blue-800 font-bold hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
