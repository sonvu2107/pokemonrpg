import { useEffect, useState } from 'react'
import { gameApi } from '../services/gameApi'

const formatRewardText = (entry) => {
    if (!entry) return 'Không còn dữ liệu thưởng'
    const parts = []

    const platinumCoinsAmount = Math.max(0, Number.parseInt(entry?.platinumCoinsAmount || entry?.promo?.platinumCoinsAmount, 10) || 0)
    const moonPointsAmount = Math.max(0, Number.parseInt(entry?.moonPointsAmount || entry?.promo?.moonPointsAmount, 10) || 0)

    if (platinumCoinsAmount > 0) {
        parts.push(`${platinumCoinsAmount.toLocaleString('vi-VN')} Xu Bạch Kim`)
    }
    if (moonPointsAmount > 0) {
        parts.push(`${moonPointsAmount.toLocaleString('vi-VN')} Điểm Nguyệt Các`)
    }

    const rewards = Array.isArray(entry?.itemRewards)
        ? entry.itemRewards
        : (Array.isArray(entry?.promo?.itemRewards) ? entry.promo.itemRewards : [])

    rewards.forEach((row) => {
        const qty = Number(row?.quantity || 0)
        if (qty <= 0) return
        const name = row?.item?.name || 'Vật phẩm'
        parts.push(`${qty.toLocaleString('vi-VN')} x ${name}`)
    })

    const pokemonQuantity = Math.max(0, Number.parseInt(entry?.pokemonQuantity || entry?.promo?.pokemonQuantity, 10) || 0)
    if (pokemonQuantity > 0) {
        const pokemonName = entry?.pokemon?.name || entry?.promo?.pokemon?.name || 'Pokemon'
        const level = Math.max(1, Number.parseInt(entry?.pokemon?.level || entry?.promo?.pokemonConfig?.level, 10) || 5)
        const isShiny = Boolean(entry?.pokemon?.isShiny || entry?.promo?.pokemonConfig?.isShiny)
        parts.push(`${pokemonQuantity.toLocaleString('vi-VN')} x ${pokemonName} Lv.${level}${isShiny ? ' (Shiny)' : ''}`)
    }

    if (parts.length > 0) return parts.join(', ')

    const amount = Number(entry?.amount || entry?.promo?.amount || 0)
    return `${amount.toLocaleString('vi-VN')} thưởng`
}

export default function PromoCodePage() {
    const [loading, setLoading] = useState(true)
    const [redeeming, setRedeeming] = useState(false)
    const [code, setCode] = useState('')
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [history, setHistory] = useState([])

    useEffect(() => {
        loadHistory()
    }, [])

    const loadHistory = async () => {
        try {
            setLoading(true)
            const data = await gameApi.getPromoCodeHistory({ limit: 20 })
            setHistory(Array.isArray(data?.history) ? data.history : [])
        } catch (err) {
            setError(err.message || 'Không thể tải lịch sử nhập code')
        } finally {
            setLoading(false)
        }
    }

    const handleRedeem = async (event) => {
        event.preventDefault()

        try {
            setRedeeming(true)
            setError('')
            setSuccess('')
            const data = await gameApi.redeemPromoCode(String(code || '').trim().toUpperCase())
            setCode('')
            setSuccess(data?.claimResult
                ? `Nhập code thành công: ${formatRewardText(data.claimResult)}`
                : (data?.message || 'Nhập code thành công'))
            await loadHistory()
        } catch (err) {
            setError(err.message || 'Nhập code thất bại')
        } finally {
            setRedeeming(false)
        }
    }

    return (
        <div className="max-w-4xl mx-auto space-y-5">
            <section className="rounded-lg border border-blue-300 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-500 border-b border-blue-600">
                    <h1 className="text-lg sm:text-xl font-bold text-white uppercase tracking-wide">Nhập Mã Quà Tặng</h1>
                </div>

                <div className="p-4 sm:p-5 space-y-3">
                    <p className="text-sm text-slate-600">
                        Nhập mã code do admin phát hành để nhận thưởng ngay vào tài khoản.
                    </p>

                    {error && (
                        <div className="px-3 py-2 rounded border border-red-200 bg-red-50 text-red-700 text-sm font-medium">
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="px-3 py-2 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-medium">
                            {success}
                        </div>
                    )}

                    <form onSubmit={handleRedeem} className="flex flex-col sm:flex-row gap-2">
                        <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(String(e.target.value || '').toUpperCase())}
                            maxLength={30}
                            placeholder="VD: WELCOME2026"
                            className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm font-semibold tracking-wide focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                            type="submit"
                            disabled={redeeming || !String(code || '').trim()}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-bold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {redeeming ? 'Đang nhập...' : 'Nhập code'}
                        </button>
                    </form>
                </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
                    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Lịch sử nhập code</h2>
                </div>

                {loading ? (
                    <div className="p-4 text-sm text-slate-500">Đang tải lịch sử...</div>
                ) : history.length === 0 ? (
                    <div className="p-4 text-sm text-slate-500">Bạn chưa nhập mã code nào.</div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {history.map((entry) => (
                            <div key={entry._id} className="p-4 flex flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-xs font-black tracking-wide">
                                        {entry?.promo?.code || 'Mã cũ'}
                                    </span>
                                    <span className="text-sm font-bold text-slate-800">
                                        {entry?.promo?.title || 'Mã đã bị xóa'}
                                    </span>
                                </div>

                                <div className="text-xs text-slate-600">
                                    Thưởng: {formatRewardText(entry.promo)}
                                </div>

                                <div className="text-xs text-slate-500">
                                    Đã nhập: {Number(entry.claimCount || 0).toLocaleString('vi-VN')} lần
                                    {' · '}
                                    Lần gần nhất: {entry.lastClaimAt ? new Date(entry.lastClaimAt).toLocaleString('vi-VN') : '--'}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}
