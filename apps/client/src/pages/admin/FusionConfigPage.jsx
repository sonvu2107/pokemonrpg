import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fusionConfigApi } from '../../services/adminApi'

const buildDefaultForm = () => ({
    strictMaterialUntilFusionLevel: 5,
    superFusionStoneBonusPercent: 10,
    finalSuccessRateCapPercent: 99,
    baseSuccessRateByFusionLevel: [90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15],
    totalStatBonusPercentByFusionLevel: [0, 1, 2, 3, 4, 5, 6, 7.5, 9, 11, 13, 15, 18, 21, 24, 28, 32, 37, 42, 48, 55],
    failurePenaltyByLevelBracket: {
        fromLevel5: 1,
        fromLevel10: 2,
        fromLevel15: 3,
    },
    failureLevelThresholdByBracket: {
        fromLevel5: 5,
        fromLevel10: 10,
        fromLevel15: 15,
    },
    milestones: [
        { from: 0, to: 4, label: '1-5 sao vàng' },
        { from: 5, to: 9, label: '+10 (5 sao xanh đậm)' },
        { from: 10, to: 14, label: '+15 (5 sao tím)' },
        { from: 15, to: null, label: '5 sao đỏ' },
    ],
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const toSafeInt = (value, fallback = 0, min = 0, max = 999999) => {
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed)) return fallback
    return clamp(parsed, min, max)
}

const toSafeNumber = (value, fallback = 0, min = 0, max = 100) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return clamp(parsed, min, max)
}

const normalizeForSubmit = (formData) => {
    const fallback = buildDefaultForm()

    const baseSuccessRateByFusionLevel = (Array.isArray(formData?.baseSuccessRateByFusionLevel)
        ? formData.baseSuccessRateByFusionLevel
        : [])
        .map((entry, index) => toSafeNumber(entry, fallback.baseSuccessRateByFusionLevel[index] ?? 0, 0, 100))
    const totalStatBonusPercentByFusionLevel = (Array.isArray(formData?.totalStatBonusPercentByFusionLevel)
        ? formData.totalStatBonusPercentByFusionLevel
        : [])
        .map((entry, index) => toSafeNumber(entry, fallback.totalStatBonusPercentByFusionLevel[index] ?? 0, 0, 500))

    const milestones = (Array.isArray(formData?.milestones) ? formData.milestones : [])
        .map((entry, index) => {
            const from = toSafeInt(entry?.from, 0, 0, 9999)
            const toRaw = entry?.to
            const to = toRaw === '' || toRaw === null || toRaw === undefined
                ? null
                : toSafeInt(toRaw, from, from, 9999)
            const label = String(entry?.label || '').trim().slice(0, 80)
            if (!label) return null
            return {
                from,
                to,
                label,
            }
        })
        .filter(Boolean)
        .sort((left, right) => left.from - right.from)

    if (baseSuccessRateByFusionLevel.length === 0) {
        throw new Error('Bạn cần nhập ít nhất 1 mốc tỉ lệ thành công')
    }

    if (totalStatBonusPercentByFusionLevel.length === 0) {
        throw new Error('Bạn cần nhập ít nhất 1 mốc buff tổng chỉ số')
    }

    if (milestones.length === 0) {
        throw new Error('Bạn cần có ít nhất 1 mốc sao hiển thị')
    }

    return {
        strictMaterialUntilFusionLevel: toSafeInt(formData?.strictMaterialUntilFusionLevel, fallback.strictMaterialUntilFusionLevel, 0, 999),
        superFusionStoneBonusPercent: toSafeNumber(formData?.superFusionStoneBonusPercent, fallback.superFusionStoneBonusPercent, 0, 100),
        finalSuccessRateCapPercent: toSafeNumber(formData?.finalSuccessRateCapPercent, fallback.finalSuccessRateCapPercent, 0, 100),
        baseSuccessRateByFusionLevel,
        totalStatBonusPercentByFusionLevel,
        failurePenaltyByLevelBracket: {
            fromLevel5: toSafeInt(formData?.failurePenaltyByLevelBracket?.fromLevel5, fallback.failurePenaltyByLevelBracket.fromLevel5, 0, 99),
            fromLevel10: toSafeInt(formData?.failurePenaltyByLevelBracket?.fromLevel10, fallback.failurePenaltyByLevelBracket.fromLevel10, 0, 99),
            fromLevel15: toSafeInt(formData?.failurePenaltyByLevelBracket?.fromLevel15, fallback.failurePenaltyByLevelBracket.fromLevel15, 0, 99),
        },
        failureLevelThresholdByBracket: {
            fromLevel5: toSafeInt(formData?.failureLevelThresholdByBracket?.fromLevel5, fallback.failureLevelThresholdByBracket.fromLevel5, 0, 9999),
            fromLevel10: toSafeInt(formData?.failureLevelThresholdByBracket?.fromLevel10, fallback.failureLevelThresholdByBracket.fromLevel10, 0, 9999),
            fromLevel15: toSafeInt(formData?.failureLevelThresholdByBracket?.fromLevel15, fallback.failureLevelThresholdByBracket.fromLevel15, 0, 9999),
        },
        milestones,
    }
}

export default function FusionConfigPage() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [rollingBackId, setRollingBackId] = useState('')
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [formData, setFormData] = useState(buildDefaultForm)
    const [updatedInfo, setUpdatedInfo] = useState({ updatedAt: null, updatedBy: null })
    const [historyRows, setHistoryRows] = useState([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [saveChangeNote, setSaveChangeNote] = useState('')
    const [isBaseRateSectionExpanded, setIsBaseRateSectionExpanded] = useState(true)
    const [isStatBonusSectionExpanded, setIsStatBonusSectionExpanded] = useState(true)
    const [historyPage, setHistoryPage] = useState(1)
    const [historyPagination, setHistoryPagination] = useState({ page: 1, pages: 1, total: 0, limit: 12 })
    const [historyFilters, setHistoryFilters] = useState({
        action: '',
        keyword: '',
        updatedBy: '',
        fromDate: '',
        toDate: '',
        sort: 'desc',
        limit: 12,
    })

    const loadConfig = async () => {
        try {
            setLoading(true)
            setError('')
            const data = await fusionConfigApi.get()
            const payload = data?.config || {}
            setFormData({
                strictMaterialUntilFusionLevel: Number(payload?.strictMaterialUntilFusionLevel ?? 5),
                superFusionStoneBonusPercent: Number(payload?.superFusionStoneBonusPercent ?? 10),
                finalSuccessRateCapPercent: Number(payload?.finalSuccessRateCapPercent ?? 99),
                baseSuccessRateByFusionLevel: Array.isArray(payload?.baseSuccessRateByFusionLevel)
                    ? payload.baseSuccessRateByFusionLevel.map((entry) => Number(entry || 0))
                    : buildDefaultForm().baseSuccessRateByFusionLevel,
                totalStatBonusPercentByFusionLevel: Array.isArray(payload?.totalStatBonusPercentByFusionLevel)
                    ? payload.totalStatBonusPercentByFusionLevel.map((entry) => Number(entry || 0))
                    : buildDefaultForm().totalStatBonusPercentByFusionLevel,
                failurePenaltyByLevelBracket: {
                    fromLevel5: Number(payload?.failurePenaltyByLevelBracket?.fromLevel5 ?? 1),
                    fromLevel10: Number(payload?.failurePenaltyByLevelBracket?.fromLevel10 ?? 2),
                    fromLevel15: Number(payload?.failurePenaltyByLevelBracket?.fromLevel15 ?? 3),
                },
                failureLevelThresholdByBracket: {
                    fromLevel5: Number(payload?.failureLevelThresholdByBracket?.fromLevel5 ?? 5),
                    fromLevel10: Number(payload?.failureLevelThresholdByBracket?.fromLevel10 ?? 10),
                    fromLevel15: Number(payload?.failureLevelThresholdByBracket?.fromLevel15 ?? 15),
                },
                milestones: Array.isArray(payload?.milestones)
                    ? payload.milestones.map((entry) => ({
                        from: Number(entry?.from || 0),
                        to: entry?.to === null || entry?.to === undefined ? null : Number(entry.to),
                        label: String(entry?.label || '').trim(),
                    }))
                    : buildDefaultForm().milestones,
            })
            setUpdatedInfo({
                updatedAt: payload?.updatedAt || null,
                updatedBy: payload?.updatedBy || null,
            })
        } catch (err) {
            setError(err.message || 'Không thể tải cấu hình ghép Pokemon')
        } finally {
            setLoading(false)
        }
    }

    const loadHistory = async ({
        page = historyPage,
        filters = historyFilters,
    } = {}) => {
        try {
            setHistoryLoading(true)
            const data = await fusionConfigApi.getHistory({
                page,
                limit: filters.limit,
                action: filters.action,
                keyword: filters.keyword,
                updatedBy: filters.updatedBy,
                fromDate: filters.fromDate,
                toDate: filters.toDate,
                sort: filters.sort,
            })
            setHistoryRows(Array.isArray(data?.rows) ? data.rows : [])
            const pagination = data?.pagination || {}
            setHistoryPagination({
                page: Math.max(1, Number(pagination.page || page)),
                pages: Math.max(1, Number(pagination.pages || 1)),
                total: Math.max(0, Number(pagination.total || 0)),
                limit: Math.max(1, Number(pagination.limit || filters.limit || 12)),
            })
            setHistoryPage(Math.max(1, Number(pagination.page || page)))
        } catch (err) {
            setHistoryRows([])
            setHistoryPagination({ page: 1, pages: 1, total: 0, limit: Math.max(1, Number(historyFilters.limit || 12)) })
            setError(err.message || 'Không thể tải lịch sử cấu hình ghép Pokemon')
        } finally {
            setHistoryLoading(false)
        }
    }

    useEffect(() => {
        Promise.all([loadConfig(), loadHistory()])
    }, [])

    const handleApplyHistoryFilters = async () => {
        await loadHistory({ page: 1, filters: historyFilters })
    }

    const handleResetHistoryFilters = async () => {
        const nextFilters = {
            action: '',
            keyword: '',
            updatedBy: '',
            fromDate: '',
            toDate: '',
            sort: 'desc',
            limit: 12,
        }
        setHistoryFilters(nextFilters)
        await loadHistory({ page: 1, filters: nextFilters })
    }

    const baseRateRows = useMemo(() => {
        const rates = Array.isArray(formData?.baseSuccessRateByFusionLevel)
            ? formData.baseSuccessRateByFusionLevel
            : []
        return rates.map((rate, level) => ({
            level,
            rate: Number(rate || 0),
        }))
    }, [formData])

    const updateBaseRate = (index, nextValue) => {
        setFormData((prev) => {
            const rows = Array.isArray(prev.baseSuccessRateByFusionLevel)
                ? [...prev.baseSuccessRateByFusionLevel]
                : []
            rows[index] = nextValue
            return {
                ...prev,
                baseSuccessRateByFusionLevel: rows,
            }
        })
    }

    const addBaseRateLevel = () => {
        setFormData((prev) => ({
            ...prev,
            baseSuccessRateByFusionLevel: [
                ...(Array.isArray(prev.baseSuccessRateByFusionLevel) ? prev.baseSuccessRateByFusionLevel : []),
                10,
            ],
        }))
    }

    const removeBaseRateLevel = () => {
        setFormData((prev) => {
            const rows = Array.isArray(prev.baseSuccessRateByFusionLevel)
                ? [...prev.baseSuccessRateByFusionLevel]
                : []
            if (rows.length <= 1) return prev
            rows.pop()
            return {
                ...prev,
                baseSuccessRateByFusionLevel: rows,
            }
        })
    }

    const totalStatBonusRows = useMemo(() => {
        const rows = Array.isArray(formData?.totalStatBonusPercentByFusionLevel)
            ? formData.totalStatBonusPercentByFusionLevel
            : []
        return rows.map((bonus, level) => ({
            level,
            bonus: Number(bonus || 0),
        }))
    }, [formData])

    const updateTotalStatBonus = (index, nextValue) => {
        setFormData((prev) => {
            const rows = Array.isArray(prev.totalStatBonusPercentByFusionLevel)
                ? [...prev.totalStatBonusPercentByFusionLevel]
                : []
            rows[index] = nextValue
            return {
                ...prev,
                totalStatBonusPercentByFusionLevel: rows,
            }
        })
    }

    const addTotalStatBonusLevel = () => {
        setFormData((prev) => ({
            ...prev,
            totalStatBonusPercentByFusionLevel: [
                ...(Array.isArray(prev.totalStatBonusPercentByFusionLevel) ? prev.totalStatBonusPercentByFusionLevel : []),
                55,
            ],
        }))
    }

    const removeTotalStatBonusLevel = () => {
        setFormData((prev) => {
            const rows = Array.isArray(prev.totalStatBonusPercentByFusionLevel)
                ? [...prev.totalStatBonusPercentByFusionLevel]
                : []
            if (rows.length <= 1) return prev
            rows.pop()
            return {
                ...prev,
                totalStatBonusPercentByFusionLevel: rows,
            }
        })
    }

    const updateMilestone = (index, patch) => {
        setFormData((prev) => {
            const rows = Array.isArray(prev.milestones) ? [...prev.milestones] : []
            rows[index] = {
                ...rows[index],
                ...patch,
            }
            return {
                ...prev,
                milestones: rows,
            }
        })
    }

    const addMilestone = () => {
        setFormData((prev) => ({
            ...prev,
            milestones: [
                ...(Array.isArray(prev.milestones) ? prev.milestones : []),
                { from: 0, to: null, label: '' },
            ],
        }))
    }

    const removeMilestone = (index) => {
        setFormData((prev) => {
            const rows = Array.isArray(prev.milestones) ? [...prev.milestones] : []
            rows.splice(index, 1)
            return {
                ...prev,
                milestones: rows,
            }
        })
    }

    const handleSave = async () => {
        try {
            setSaving(true)
            setError('')
            setSuccess('')
            const payload = {
                ...normalizeForSubmit(formData),
                changeNote: String(saveChangeNote || '').trim(),
            }
            const data = await fusionConfigApi.update(payload)
            const savedConfig = data?.config || payload
            setFormData({
                ...savedConfig,
                milestones: Array.isArray(savedConfig?.milestones)
                    ? savedConfig.milestones.map((entry) => ({
                        ...entry,
                        to: entry?.to === null || entry?.to === undefined ? null : Number(entry.to),
                    }))
                    : [],
            })
            setUpdatedInfo({
                updatedAt: savedConfig?.updatedAt || null,
                updatedBy: savedConfig?.updatedBy || null,
            })
            setSuccess(data?.message || 'Đã lưu cấu hình ghép Pokemon')
            setSaveChangeNote('')
            await loadHistory()
        } catch (err) {
            setError(err.message || 'Lưu cấu hình ghép Pokemon thất bại')
        } finally {
            setSaving(false)
        }
    }

    const handleRollback = async (revisionId) => {
        const targetRevisionId = String(revisionId || '').trim()
        if (!targetRevisionId) return

        try {
            setRollingBackId(targetRevisionId)
            setError('')
            setSuccess('')
            const data = await fusionConfigApi.rollback(targetRevisionId, {
                changeNote: `Rollback về bản ghi ${targetRevisionId}`,
            })
            const savedConfig = data?.config || null
            if (savedConfig) {
                setFormData((prev) => ({
                    ...prev,
                    ...savedConfig,
                    milestones: Array.isArray(savedConfig?.milestones)
                        ? savedConfig.milestones.map((entry) => ({
                            ...entry,
                            to: entry?.to === null || entry?.to === undefined ? null : Number(entry.to),
                        }))
                        : [],
                }))
                setUpdatedInfo({
                    updatedAt: savedConfig?.updatedAt || null,
                    updatedBy: savedConfig?.updatedBy || null,
                })
            }
            setSuccess(data?.message || 'Rollback cấu hình ghép Pokemon thành công')
            await loadHistory()
        } catch (err) {
            setError(err.message || 'Rollback cấu hình ghép Pokemon thất bại')
        } finally {
            setRollingBackId('')
        }
    }

    if (loading) {
        return <div className="text-center py-8 text-blue-800 font-medium">Đang tải cấu hình ghép Pokemon...</div>
    }

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between gap-3 sm:items-center bg-white p-4 rounded-lg shadow-sm border border-blue-100">
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Cấu Hình Ghép Pokemon</h1>
                </div>
                <Link
                    to="/admin"
                    className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-sm font-bold shadow-sm transition-all"
                >
                    Quay lại
                </Link>
            </div>

            {updatedInfo?.updatedAt && (
                <div className="p-3 rounded border border-slate-200 bg-slate-50 text-xs text-slate-600">
                    Cập nhật gần nhất: {new Date(updatedInfo.updatedAt).toLocaleString('vi-VN')}
                    {updatedInfo?.updatedBy?.username ? ` bởi ${updatedInfo.updatedBy.username}` : ''}
                </div>
            )}

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

            <section className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 border-b border-blue-600">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Quy tắc chung</h2>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Mốc bắt buộc cùng loài / cùng dạng / cùng cấp</label>
                        <input
                            type="number"
                            min="0"
                            max="999"
                            value={formData.strictMaterialUntilFusionLevel}
                            onChange={(event) => setFormData((prev) => ({ ...prev, strictMaterialUntilFusionLevel: event.target.value }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-slate-500">Ví dụ: 5 nghĩa là từ +0 đến +4 bắt buộc giống hệt.</p>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Bonus của Super Fusion Stone (%)</label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={formData.superFusionStoneBonusPercent}
                            onChange={(event) => setFormData((prev) => ({ ...prev, superFusionStoneBonusPercent: event.target.value }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Giới hạn tỉ lệ thành công tối đa (%)</label>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={formData.finalSuccessRateCapPercent}
                            onChange={(event) => setFormData((prev) => ({ ...prev, finalSuccessRateCapPercent: event.target.value }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>
            </section>

            <section className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 border-b border-blue-600 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Tỉ lệ thành công theo mốc</h2>
                    <div className="flex items-center gap-1">
                        {isBaseRateSectionExpanded && (
                            <>
                                <button
                                    type="button"
                                    onClick={addBaseRateLevel}
                                    className="px-2 py-1 text-xs rounded bg-white/90 text-blue-700 font-bold hover:bg-white"
                                >
                                    + Mốc
                                </button>
                                <button
                                    type="button"
                                    onClick={removeBaseRateLevel}
                                    className="px-2 py-1 text-xs rounded bg-white/90 text-blue-700 font-bold hover:bg-white"
                                >
                                    - Mốc
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={() => setIsBaseRateSectionExpanded((prev) => !prev)}
                            className="px-2 py-1 text-xs rounded bg-white/90 text-blue-700 font-bold hover:bg-white"
                        >
                            {isBaseRateSectionExpanded ? 'Thu gọn' : 'Mở rộng'}
                        </button>
                    </div>
                </div>
                <div className="p-4">
                    {!isBaseRateSectionExpanded ? (
                        <div className="text-sm text-slate-600">
                            Đã thu gọn bảng tỉ lệ. Hiện có <span className="font-bold text-slate-800">{baseRateRows.length}</span> mốc đã cấu hình.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm border border-slate-200 rounded overflow-hidden">
                                <thead className="bg-slate-100 text-slate-700">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-bold border-b border-slate-200">Mốc ghép</th>
                                        <th className="px-3 py-2 text-left font-bold border-b border-slate-200">Tỉ lệ gốc (%)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {baseRateRows.map((entry) => (
                                        <tr key={`fusion-rate-${entry.level}`} className="odd:bg-white even:bg-slate-50">
                                            <td className="px-3 py-2 border-b border-slate-100">+{entry.level}</td>
                                            <td className="px-3 py-2 border-b border-slate-100">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.1"
                                                    value={entry.rate}
                                                    onChange={(event) => updateBaseRate(entry.level, event.target.value)}
                                                    className="w-40 px-2 py-1 border border-slate-300 rounded"
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>

            <section className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 border-b border-blue-600 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Buff tổng chỉ số theo mốc</h2>
                    <div className="flex items-center gap-1">
                        {isStatBonusSectionExpanded && (
                            <>
                                <button
                                    type="button"
                                    onClick={addTotalStatBonusLevel}
                                    className="px-2 py-1 text-xs rounded bg-white/90 text-blue-700 font-bold hover:bg-white"
                                >
                                    + Mốc
                                </button>
                                <button
                                    type="button"
                                    onClick={removeTotalStatBonusLevel}
                                    className="px-2 py-1 text-xs rounded bg-white/90 text-blue-700 font-bold hover:bg-white"
                                >
                                    - Mốc
                                </button>
                            </>
                        )}
                        <button
                            type="button"
                            onClick={() => setIsStatBonusSectionExpanded((prev) => !prev)}
                            className="px-2 py-1 text-xs rounded bg-white/90 text-blue-700 font-bold hover:bg-white"
                        >
                            {isStatBonusSectionExpanded ? 'Thu gọn' : 'Mở rộng'}
                        </button>
                    </div>
                </div>
                <div className="p-4">
                    {!isStatBonusSectionExpanded ? (
                        <div className="text-sm text-slate-600">
                            Đã thu gọn bảng buff chỉ số. Hiện có <span className="font-bold text-slate-800">{totalStatBonusRows.length}</span> mốc đã cấu hình.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm border border-slate-200 rounded overflow-hidden">
                                <thead className="bg-slate-100 text-slate-700">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-bold border-b border-slate-200">Mốc ghép</th>
                                        <th className="px-3 py-2 text-left font-bold border-b border-slate-200">Buff tổng chỉ số (%)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {totalStatBonusRows.map((entry) => (
                                        <tr key={`fusion-stat-bonus-${entry.level}`} className="odd:bg-white even:bg-slate-50">
                                            <td className="px-3 py-2 border-b border-slate-100">+{entry.level}</td>
                                            <td className="px-3 py-2 border-b border-slate-100">
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="500"
                                                    step="0.1"
                                                    value={entry.bonus}
                                                    onChange={(event) => updateTotalStatBonus(entry.level, event.target.value)}
                                                    className="w-40 px-2 py-1 border border-slate-300 rounded"
                                                />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </section>

            <section className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 border-b border-blue-600">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Mức phạt khi ghép thất bại</h2>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Mốc bắt đầu 1</label>
                        <input
                            type="number"
                            min="0"
                            max="9999"
                            value={formData.failureLevelThresholdByBracket.fromLevel5}
                            onChange={(event) => setFormData((prev) => ({
                                ...prev,
                                failureLevelThresholdByBracket: {
                                    ...prev.failureLevelThresholdByBracket,
                                    fromLevel5: event.target.value,
                                },
                            }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <label className="block text-xs font-bold text-slate-600 mt-2 mb-1">Số mốc bị trừ</label>
                        <input
                            type="number"
                            min="0"
                            max="99"
                            value={formData.failurePenaltyByLevelBracket.fromLevel5}
                            onChange={(event) => setFormData((prev) => ({
                                ...prev,
                                failurePenaltyByLevelBracket: {
                                    ...prev.failurePenaltyByLevelBracket,
                                    fromLevel5: event.target.value,
                                },
                            }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Mốc bắt đầu 2</label>
                        <input
                            type="number"
                            min="0"
                            max="9999"
                            value={formData.failureLevelThresholdByBracket.fromLevel10}
                            onChange={(event) => setFormData((prev) => ({
                                ...prev,
                                failureLevelThresholdByBracket: {
                                    ...prev.failureLevelThresholdByBracket,
                                    fromLevel10: event.target.value,
                                },
                            }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <label className="block text-xs font-bold text-slate-600 mt-2 mb-1">Số mốc bị trừ</label>
                        <input
                            type="number"
                            min="0"
                            max="99"
                            value={formData.failurePenaltyByLevelBracket.fromLevel10}
                            onChange={(event) => setFormData((prev) => ({
                                ...prev,
                                failurePenaltyByLevelBracket: {
                                    ...prev.failurePenaltyByLevelBracket,
                                    fromLevel10: event.target.value,
                                },
                            }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">Mốc bắt đầu 3</label>
                        <input
                            type="number"
                            min="0"
                            max="9999"
                            value={formData.failureLevelThresholdByBracket.fromLevel15}
                            onChange={(event) => setFormData((prev) => ({
                                ...prev,
                                failureLevelThresholdByBracket: {
                                    ...prev.failureLevelThresholdByBracket,
                                    fromLevel15: event.target.value,
                                },
                            }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <label className="block text-xs font-bold text-slate-600 mt-2 mb-1">Số mốc bị trừ</label>
                        <input
                            type="number"
                            min="0"
                            max="99"
                            value={formData.failurePenaltyByLevelBracket.fromLevel15}
                            onChange={(event) => setFormData((prev) => ({
                                ...prev,
                                failurePenaltyByLevelBracket: {
                                    ...prev.failurePenaltyByLevelBracket,
                                    fromLevel15: event.target.value,
                                },
                            }))}
                            className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>
            </section>

            <section className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 border-b border-blue-600 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Mốc sao hiển thị</h2>
                    <button
                        type="button"
                        onClick={addMilestone}
                        className="px-2 py-1 text-xs rounded bg-white/90 text-blue-700 font-bold hover:bg-white"
                    >
                        + Thêm mốc
                    </button>
                </div>
                <div className="p-4 space-y-3">
                    {(Array.isArray(formData.milestones) ? formData.milestones : []).map((entry, index) => (
                        <div key={`milestone-row-${index}`} className="grid grid-cols-1 md:grid-cols-[120px_120px_minmax(0,1fr)_auto] gap-2 items-center border border-slate-200 rounded p-3 bg-slate-50">
                            <input
                                type="number"
                                min="0"
                                max="9999"
                                value={entry.from}
                                onChange={(event) => updateMilestone(index, { from: event.target.value })}
                                className="px-3 py-2 border border-slate-300 rounded text-sm"
                                placeholder="Từ +"
                            />
                            <input
                                type="number"
                                min="0"
                                max="9999"
                                value={entry.to ?? ''}
                                onChange={(event) => updateMilestone(index, { to: event.target.value })}
                                className="px-3 py-2 border border-slate-300 rounded text-sm"
                                placeholder="Đến +"
                            />
                            <input
                                type="text"
                                maxLength={80}
                                value={entry.label}
                                onChange={(event) => updateMilestone(index, { label: event.target.value })}
                                className="px-3 py-2 border border-slate-300 rounded text-sm"
                                placeholder="Ví dụ: +10 (5 sao xanh đậm)"
                            />
                            <button
                                type="button"
                                onClick={() => removeMilestone(index)}
                                className="px-3 py-2 rounded border border-red-200 bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100"
                            >
                                Xóa
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            <section className="bg-white rounded-lg border border-blue-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-gradient-to-r from-slate-700 to-slate-900 border-b border-slate-700 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold text-white uppercase tracking-wider">Lịch sử cấu hình</h2>
                    <button
                        type="button"
                        onClick={() => loadHistory({ page: historyPage, filters: historyFilters })}
                        className="px-2 py-1 text-xs rounded bg-white/90 text-slate-700 font-bold hover:bg-white"
                    >
                        Làm mới
                    </button>
                </div>

                <div className="p-4 border-b border-slate-200 bg-slate-50 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                    <select
                        value={historyFilters.action}
                        onChange={(event) => setHistoryFilters((prev) => ({ ...prev, action: event.target.value }))}
                        className="px-3 py-2 border border-slate-300 rounded text-sm"
                    >
                        <option value="">Tất cả hành động</option>
                        <option value="update">Chỉ cập nhật</option>
                        <option value="rollback">Chỉ rollback</option>
                    </select>

                    <input
                        type="text"
                        value={historyFilters.keyword}
                        onChange={(event) => setHistoryFilters((prev) => ({ ...prev, keyword: event.target.value }))}
                        placeholder="Tìm theo ghi chú..."
                        className="px-3 py-2 border border-slate-300 rounded text-sm"
                    />

                    <input
                        type="date"
                        value={historyFilters.fromDate}
                        onChange={(event) => setHistoryFilters((prev) => ({ ...prev, fromDate: event.target.value }))}
                        className="px-3 py-2 border border-slate-300 rounded text-sm"
                    />

                    <input
                        type="date"
                        value={historyFilters.toDate}
                        onChange={(event) => setHistoryFilters((prev) => ({ ...prev, toDate: event.target.value }))}
                        className="px-3 py-2 border border-slate-300 rounded text-sm"
                    />

                    <select
                        value={historyFilters.sort}
                        onChange={(event) => setHistoryFilters((prev) => ({ ...prev, sort: event.target.value }))}
                        className="px-3 py-2 border border-slate-300 rounded text-sm"
                    >
                        <option value="desc">Mới nhất trước</option>
                        <option value="asc">Cũ nhất trước</option>
                    </select>

                    <select
                        value={historyFilters.limit}
                        onChange={(event) => setHistoryFilters((prev) => ({ ...prev, limit: Number(event.target.value) || 12 }))}
                        className="px-3 py-2 border border-slate-300 rounded text-sm"
                    >
                        <option value="10">10 dòng/trang</option>
                        <option value="20">20 dòng/trang</option>
                        <option value="50">50 dòng/trang</option>
                    </select>

                    <button
                        type="button"
                        onClick={handleApplyHistoryFilters}
                        className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
                    >
                        Áp dụng bộ lọc
                    </button>

                    <button
                        type="button"
                        onClick={handleResetHistoryFilters}
                        className="px-3 py-2 rounded border border-slate-300 bg-white text-slate-700 text-sm font-bold hover:bg-slate-100"
                    >
                        Đặt lại
                    </button>
                </div>

                <div className="p-4">
                    <div className="mb-2 text-xs text-slate-500">Tổng bản ghi: {historyPagination.total.toLocaleString('vi-VN')}</div>
                    {historyLoading ? (
                        <div className="text-sm text-slate-500">Đang tải lịch sử...</div>
                    ) : historyRows.length === 0 ? (
                        <div className="text-sm text-slate-500">Chưa có bản ghi cấu hình.</div>
                    ) : (
                        <div className="space-y-2">
                            {historyRows.map((row) => {
                                const revisionId = String(row?._id || '')
                                const isRollingBack = rollingBackId === revisionId
                                return (
                                    <div key={revisionId} className="border border-slate-200 rounded p-3 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                        <div className="text-xs text-slate-700">
                                            <div className="font-bold text-slate-800">
                                                {row?.action === 'rollback' ? 'Rollback' : 'Cập nhật'}
                                                {row?.createdAt ? ` • ${new Date(row.createdAt).toLocaleString('vi-VN')}` : ''}
                                            </div>
                                            <div>
                                                Bởi: {row?.updatedBy?.username || 'Hệ thống'}
                                            </div>
                                            <div>
                                                Strict: +{Number(row?.strictMaterialUntilFusionLevel || 0)} • Super: +{Number(row?.superFusionStoneBonusPercent || 0)}% • Cap: {Number(row?.finalSuccessRateCapPercent || 0)}%
                                            </div>
                                            {String(row?.changeNote || '').trim() && (
                                                <div className="mt-1 text-slate-600">Ghi chú: {row.changeNote}</div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleRollback(revisionId)}
                                            disabled={Boolean(rollingBackId) || saving}
                                            className="px-3 py-2 rounded border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold hover:bg-amber-100 disabled:opacity-60"
                                        >
                                            {isRollingBack ? 'Đang rollback...' : 'Rollback mốc này'}
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {historyPagination.pages > 1 && (
                        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
                            <button
                                type="button"
                                onClick={() => loadHistory({ page: Math.max(1, historyPage - 1), filters: historyFilters })}
                                disabled={historyPage <= 1 || historyLoading}
                                className="px-3 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-50"
                            >
                                Trước
                            </button>
                            <span className="font-semibold text-slate-700">Trang {historyPagination.page}/{historyPagination.pages}</span>
                            <button
                                type="button"
                                onClick={() => loadHistory({ page: Math.min(historyPagination.pages, historyPage + 1), filters: historyFilters })}
                                disabled={historyPage >= historyPagination.pages || historyLoading}
                                className="px-3 py-1 rounded border border-slate-300 bg-white text-slate-700 disabled:opacity-50"
                            >
                                Sau
                            </button>
                        </div>
                    )}
                </div>
            </section>

            <div className="flex flex-wrap justify-end gap-2">
                <div className="w-full">
                    <label className="block text-xs font-bold text-slate-600 mb-1">Ghi chú thay đổi (audit)</label>
                    <input
                        type="text"
                        maxLength={300}
                        value={saveChangeNote}
                        onChange={(event) => setSaveChangeNote(event.target.value)}
                        placeholder="Ví dụ: Điều chỉnh lại tỉ lệ mốc +10 đến +15"
                        className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
                    />
                </div>
                <button
                    type="button"
                    onClick={loadConfig}
                    disabled={saving}
                    className="px-4 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-bold"
                >
                    Tải lại
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold shadow-sm disabled:opacity-60"
                >
                    {saving ? 'Đang lưu...' : 'Lưu cấu hình'}
                </button>
            </div>
        </div>
    )
}
