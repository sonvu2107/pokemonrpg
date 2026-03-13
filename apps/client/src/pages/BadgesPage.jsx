import { useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'
import SmartImage from '../components/SmartImage'

const badgeRankClassMap = {
    D: 'border-slate-300 bg-slate-100 text-slate-700',
    C: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    B: 'border-sky-300 bg-sky-50 text-sky-700',
    A: 'border-violet-300 bg-violet-50 text-violet-700',
    S: 'border-orange-300 bg-orange-50 text-orange-700',
    SS: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    SSS: 'border-rose-300 bg-gradient-to-r from-rose-50 to-amber-50 text-rose-700',
}

const getBadgeRankClasses = (rank = 'D') => badgeRankClassMap[String(rank || 'D').toUpperCase()] || badgeRankClassMap.D

const SectionHeader = ({ title, subtitle = '' }) => (
    <div className="bg-gradient-to-b from-blue-400 to-blue-600 text-white text-center px-4 py-3 border-b border-blue-700">
        <div className="font-bold">{title}</div>
        {subtitle ? <div className="text-xs font-semibold text-blue-50 mt-1">{subtitle}</div> : null}
    </div>
)

const formatBonusSummary = (activeBonuses = {}) => {
    const parts = []
    if (Number(activeBonuses?.partyDamagePercent || 0) > 0) parts.push(`+${activeBonuses.partyDamagePercent}% sát thương toàn đội`)
    if (Number(activeBonuses?.partySpeedPercent || 0) > 0) parts.push(`+${activeBonuses.partySpeedPercent}% tốc độ toàn đội`)
    if (Number(activeBonuses?.partyHpPercent || 0) > 0) parts.push(`+${activeBonuses.partyHpPercent}% máu toàn đội`)
    Object.entries(activeBonuses?.typeDamagePercentByType || {}).forEach(([type, percent]) => {
        if (Number(percent || 0) > 0) parts.push(`+${percent}% sát thương hệ ${String(type).toUpperCase()}`)
    })
    return parts.length > 0 ? parts.join(' | ') : 'Chưa có chỉ số huy hiệu nào đang được kích hoạt.'
}

const formatMissionProgress = (badge) => {
    if (badge?.missionType === 'admin_role') {
        return badge?.isUnlocked ? 'Admin' : 'Khong mo khoa'
    }
    return `${badge?.progress?.currentValue || 0}/${badge?.progress?.targetValue || 0}`
}

export default function BadgesPage() {
    const [payload, setPayload] = useState(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [filter, setFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)

    const pageSize = 8

    const loadBadges = async () => {
        try {
            setLoading(true)
            setError('')
            const data = await api.getBadges()
            setPayload(data)
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách huy hiệu')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadBadges()
    }, [])

    const badges = Array.isArray(payload?.badges) ? payload.badges : []
    const maxEquipped = Math.max(1, Number(payload?.meta?.maxEquipped || 5))
    const equippedCount = Array.isArray(payload?.equippedBadgeIds) ? payload.equippedBadgeIds.length : 0

    const filteredBadges = useMemo(() => badges.filter((badge) => {
        if (filter === 'equipped' && !badge.isEquipped) return false
        if (filter === 'unlocked' && !badge.isUnlocked) return false
        if (filter === 'locked' && badge.isUnlocked) return false

        const keyword = search.trim().toLowerCase()
        if (!keyword) return true

        return [badge.name, badge.description, badge.missionLabel, badge.rewardLabel, badge.rank]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(keyword))
    }), [badges, filter, search])

    const totalPages = Math.max(1, Math.ceil(filteredBadges.length / pageSize))

    const visibleBadges = useMemo(() => {
        const start = (page - 1) * pageSize
        return filteredBadges.slice(start, start + pageSize)
    }, [filteredBadges, page])

    useEffect(() => {
        setPage(1)
    }, [filter, search])

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages)
        }
    }, [page, totalPages])

    const handleToggleEquip = async (badgeId) => {
        try {
            setSaving(true)
            setError('')
            const currentIds = Array.isArray(payload?.equippedBadgeIds) ? payload.equippedBadgeIds : []
            const nextIds = currentIds.includes(badgeId)
                ? currentIds.filter((entry) => entry !== badgeId)
                : [...currentIds, badgeId].slice(0, maxEquipped)
            const response = await api.updateEquippedBadges(nextIds)
            setPayload((prev) => ({
                ...prev,
                badges: badges.map((badge) => ({ ...badge, isEquipped: response.equippedBadgeIds.includes(badge._id) })),
                equippedBadgeIds: response.equippedBadgeIds,
                equippedBadges: response.equippedBadges,
                activeBonuses: response.activeBonuses,
            }))
            await loadBadges()
        } catch (err) {
            setError(err.message || 'Không thể cập nhật huy hiệu mặc')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="max-w-5xl mx-auto pb-12 space-y-4">
            <div className="border border-slate-700 bg-white rounded-lg overflow-hidden shadow-sm">
                <SectionHeader title="Chỉ Số Đang Kích Hoạt" subtitle="Tổng hợp toàn bộ chỉ số từ các huy hiệu đang mặc" />
                <div className="px-4 py-4 text-center text-sm font-bold text-blue-900 bg-slate-50">
                    {formatBonusSummary(payload?.activeBonuses)}
                </div>
            </div>

            <div className="border border-slate-700 bg-white rounded-lg overflow-hidden shadow-sm">
                <SectionHeader title="Bộ Lọc" />
                <div className="px-3 py-3 bg-slate-50 space-y-3">
                    <div className="flex justify-center">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Tìm theo tên huy hiệu, nhiệm vụ, chỉ số..."
                            className="w-full max-w-xl rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm outline-none focus:border-blue-400"
                        />
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                        {[
                            ['all', 'Tất cả'],
                            ['unlocked', 'Đã mở khóa'],
                            ['locked', 'Chưa mở khóa'],
                            ['equipped', 'Đang mặc'],
                        ].map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setFilter(key)}
                                className={`px-3 py-1.5 border rounded-full font-bold text-xs transition-colors ${filter === key ? 'border-blue-700 text-blue-700 bg-blue-50' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="border border-slate-700 bg-white rounded-lg overflow-hidden shadow-sm">
                <SectionHeader title="Danh Sách Huy Hiệu" subtitle="Theo dõi tiến độ mở khóa và chọn huy hiệu đang mặc" />
                {error && <div className="px-4 py-3 text-center text-sm font-bold text-red-600 border-b border-slate-300 bg-red-50">{error}</div>}
                <div className="block md:hidden p-3 space-y-3 bg-slate-50/50">
                    {!loading && visibleBadges.length === 0 ? (
                        <div className="text-center py-10 italic text-slate-500">Chưa có huy hiệu phù hợp với bộ lọc.</div>
                    ) : visibleBadges.map((badge, index) => {
                        const canEquip = badge.isUnlocked && badge.isActive
                        const equipLimitReached = !badge.isEquipped && equippedCount >= maxEquipped
                        return (
                            <article key={badge._id} className={`rounded-2xl border p-3 shadow-sm space-y-3 ${badge.isUnlocked ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-100'}`}>
                                <div className="flex items-start gap-3">
                                    <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                                        {badge.imageUrl ? (
                                            <SmartImage
                                                src={badge.imageUrl}
                                                alt={badge.name}
                                                width={64}
                                                height={64}
                                                className={`max-h-full max-w-full object-contain ${badge.isUnlocked ? '' : 'grayscale opacity-40'}`}
                                            />
                                        ) : <span className="text-[10px] text-slate-400">Chưa có ảnh</span>}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-slate-400 mb-1">#{index + 1}</div>
                                        <div className={`font-bold text-lg leading-6 break-words ${badge.isUnlocked ? 'text-blue-800' : 'text-slate-500'}`}>{badge.name}</div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide ${getBadgeRankClasses(badge.rank)}`}>
                                                Hạng {badge.rank || 'D'}
                                            </span>
                                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${badge.isEquipped ? 'bg-emerald-50 text-emerald-700' : (badge.isUnlocked ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500')}`}>
                                                {badge.isEquipped ? 'Đang mặc' : (badge.isUnlocked ? 'Đã mở khóa' : 'Chưa mở khóa')}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {badge.description ? <div className={`text-sm break-words ${badge.isUnlocked ? 'text-slate-600' : 'text-slate-500'}`}>{badge.description}</div> : null}

                                <div className="grid grid-cols-1 gap-2 text-sm">
                                    <div className={`rounded-xl px-3 py-2 ${badge.isUnlocked ? 'bg-slate-50' : 'bg-slate-200/70'}`}>
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Nhiệm vụ</div>
                                        <div className="mt-1 text-slate-700">{badge.missionLabel}</div>
                                    </div>
                                    <div className={`rounded-xl px-3 py-2 ${badge.isUnlocked ? 'bg-sky-50' : 'bg-slate-200/70'}`}>
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-sky-700">Chỉ số thưởng</div>
                                        <div className="mt-1 text-sky-900">{badge.rewardLabel}</div>
                                    </div>
                                    <div className={`rounded-xl px-3 py-2 flex items-center justify-between gap-3 ${badge.isUnlocked ? 'bg-amber-50' : 'bg-slate-200/70'}`}>
                                        <div>
                                            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Tiến độ</div>
                                            <div className="mt-1 text-amber-900 font-bold">{formatMissionProgress(badge)}</div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={!canEquip || equipLimitReached || saving}
                                            onClick={() => handleToggleEquip(badge._id)}
                                            className={`whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-colors ${badge.isEquipped ? 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100' : 'border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                        >
                                            {badge.isEquipped ? 'Tháo' : 'Mặc'}
                                        </button>
                                    </div>
                                </div>
                            </article>
                        )
                    })}
                </div>

                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-blue-100 text-blue-900 border-b border-slate-700">
                                <th className="border-r border-slate-700 py-2 px-2 text-center w-12">#</th>
                                <th className="border-r border-slate-700 py-2 px-2 text-center w-24">Ảnh</th>
                                <th className="border-r border-slate-700 py-2 px-2 text-center">Huy hiệu</th>
                                <th className="border-r border-slate-700 py-2 px-2 text-center">Nhiệm vụ</th>
                                <th className="border-r border-slate-700 py-2 px-2 text-center">Chỉ số thưởng</th>
                                <th className="border-r border-slate-700 py-2 px-2 text-center w-24">Tiến độ</th>
                                <th className="py-2 px-2 text-center w-32">Trạng thái</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && visibleBadges.length === 0 ? (
                                <tr>
                                    <td colSpan="7" className="text-center py-10 italic text-slate-500">Chưa có huy hiệu phù hợp với bộ lọc.</td>
                                </tr>
                            ) : visibleBadges.map((badge, index) => {
                                const canEquip = badge.isUnlocked && badge.isActive
                                const equipLimitReached = !badge.isEquipped && equippedCount >= maxEquipped
                                return (
                                    <tr key={badge._id} className={`border-b border-slate-300 align-top hover:bg-slate-50/60 ${badge.isUnlocked ? 'bg-white' : 'bg-slate-100 text-slate-500'}`}>
                                        <td className="border-r border-slate-300 text-center py-3 px-1">#{index + 1}</td>
                                        <td className="border-r border-slate-300 text-center py-3 px-2">
                                            <div className="w-16 h-16 mx-auto rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                                                {badge.imageUrl ? (
                                                    <SmartImage
                                                        src={badge.imageUrl}
                                                        alt={badge.name}
                                                        width={64}
                                                        height={64}
                                                        className={`max-h-full max-w-full object-contain ${badge.isUnlocked ? '' : 'grayscale opacity-40'}`}
                                                    />
                                                ) : <span className="text-[10px] text-slate-400">Chưa có ảnh</span>}
                                            </div>
                                        </td>
                                        <td className="border-r border-slate-300 py-3 px-4 text-center w-[24%]">
                                            <div className={`font-bold text-base leading-6 ${badge.isUnlocked ? 'text-blue-800' : 'text-slate-500'}`}>{badge.name}</div>
                                            <div className="mt-2">
                                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black tracking-wide ${getBadgeRankClasses(badge.rank)}`}>
                                                    Hạng {badge.rank || 'D'}
                                                </span>
                                            </div>
                                            <div className="text-xs text-slate-500 mt-2">{badge.description || ''}</div>
                                        </td>
                                        <td className="border-r border-slate-300 py-3 px-4 text-center text-slate-700 leading-6 w-[24%]">{badge.missionLabel}</td>
                                        <td className="border-r border-slate-300 py-3 px-3 text-center text-slate-700 leading-6">{badge.rewardLabel}</td>
                                        <td className="border-r border-slate-300 py-3 px-2 text-center font-bold text-slate-700 whitespace-nowrap w-24">
                                            {formatMissionProgress(badge)}
                                        </td>
                                        <td className="py-3 px-2 text-center w-32">
                                            <div className={`text-xs font-bold mb-2 ${badge.isUnlocked ? 'text-emerald-700' : 'text-slate-500'}`}>
                                                {badge.isEquipped ? 'Đang mặc' : (badge.isUnlocked ? 'Đã mở khóa' : 'Chưa mở khóa')}
                                            </div>
                                            <button
                                                type="button"
                                                disabled={!canEquip || equipLimitReached || saving}
                                                onClick={() => handleToggleEquip(badge._id)}
                                                className={`px-3 py-1.5 border rounded-full text-xs font-bold transition-colors whitespace-nowrap ${badge.isEquipped ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100' : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                            >
                                                {badge.isEquipped ? 'Tháo' : 'Mặc'}
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                {!loading && filteredBadges.length > 0 ? (
                    <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="text-sm text-slate-600">
                            Trang <span className="font-bold text-slate-800">{page}</span> / <span className="font-bold text-slate-800">{totalPages}</span>
                        </div>
                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
                            <button type="button" onClick={() => setPage(1)} disabled={page <= 1} className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-50">Đầu</button>
                            <button type="button" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1} className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-50">Trước</button>
                            <button type="button" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages} className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-50">Sau</button>
                            <button type="button" onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700 disabled:opacity-50">Cuối</button>
                        </div>
                    </div>
                ) : null}
                {loading && <div className="text-center py-3 font-bold text-slate-500 border-t border-slate-300">Đang tải dữ liệu...</div>}
            </div>
        </div>
    )
}
