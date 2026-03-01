import { useEffect, useMemo, useState } from 'react'
import { gameApi } from '../services/gameApi'

const toDayLabel = (day) => `Ngày ${day}`

const formatRewardText = (reward) => {
    const amount = Number(reward?.amount || 0)
    if (reward?.rewardType === 'platinumCoins' || reward?.rewardType === 'gold') {
        return `${amount.toLocaleString('vi-VN')} Xu Bạch Kim`
    }
    if (reward?.rewardType === 'moonPoints') {
        return `${amount.toLocaleString('vi-VN')} Điểm Nguyệt Các`
    }
    if (reward?.rewardType === 'pokemon') {
        const pokemonName = reward?.pokemon?.name || 'Pokemon'
        const level = Math.max(1, Number.parseInt(reward?.pokemonConfig?.level, 10) || 5)
        const shinyText = reward?.pokemonConfig?.isShiny ? ' (Shiny)' : ''
        return `${amount.toLocaleString('vi-VN')} x ${pokemonName} Lv.${level}${shinyText}`
    }
    const itemName = reward?.item?.name || 'Vật phẩm'
    return `${amount.toLocaleString('vi-VN')} x ${itemName}`
}

const getRewardBadgeClass = (state) => {
    if (state === 'claimed') return 'bg-emerald-50 border-emerald-200 text-emerald-700'
    if (state === 'next') return 'bg-amber-50 border-amber-200 text-amber-700'
    return 'bg-white border-slate-200 text-slate-700'
}

export default function DailyCheckInPage() {
    const [loading, setLoading] = useState(true)
    const [claiming, setClaiming] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [rewards, setRewards] = useState([])
    const [checkIn, setCheckIn] = useState(null)
    const [serverDate, setServerDate] = useState('')
    const [cycleDays, setCycleDays] = useState(30)

    useEffect(() => {
        loadStatus()
    }, [])

    const loadStatus = async () => {
        try {
            setLoading(true)
            setError('')
            const data = await gameApi.getDailyCheckInStatus()
            setRewards(Array.isArray(data?.rewards) ? data.rewards : [])
            setCheckIn(data?.checkIn || null)
            setServerDate(data?.serverDate || '')
            setCycleDays(Math.max(1, Number.parseInt(data?.cycleDays, 10) || 30))
        } catch (err) {
            setError(err.message || 'Không thể tải dữ liệu điểm danh')
        } finally {
            setLoading(false)
        }
    }

    const handleClaim = async () => {
        try {
            setClaiming(true)
            setError('')
            setSuccess('')
            const data = await gameApi.claimDailyCheckIn()
            setRewards(Array.isArray(data?.rewards) ? data.rewards : [])
            setCheckIn(data?.checkIn || null)
            setCycleDays(Math.max(1, Number.parseInt(data?.cycleDays, 10) || cycleDays))
            if (data?.serverDate) {
                setServerDate(data.serverDate)
            }
            setSuccess(`Bạn đã nhận ${formatRewardText(data?.reward || {})}`)
        } catch (err) {
            setError(err.message || 'Điểm danh thất bại')
        } finally {
            setClaiming(false)
        }
    }

    const rewardStateByDay = useMemo(() => {
        if (!checkIn) return new Map()

        const safeCycleDays = Math.max(1, Number.parseInt(cycleDays, 10) || 30)
        const doneDaysInCycle = checkIn.claimedToday
            ? Number(checkIn.currentRewardDay || 0)
            : (checkIn.streakActive ? Number(checkIn.effectiveStreak || 0) % safeCycleDays : 0)

        const nextDay = Number(checkIn.nextRewardDay || 1)
        const map = new Map()

        for (let day = 1; day <= safeCycleDays; day += 1) {
            if (day <= doneDaysInCycle) {
                map.set(day, 'claimed')
            } else if (day === nextDay) {
                map.set(day, 'next')
            } else {
                map.set(day, 'pending')
            }
        }

        return map
    }, [checkIn, cycleDays])

    if (loading) {
        return <div className="text-center py-8 text-blue-800 font-medium">Đang tải dữ liệu điểm danh...</div>
    }

    if (!checkIn) {
        return <div className="text-center py-8 text-red-600 font-medium">Không thể tải trạng thái điểm danh</div>
    }

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="rounded-lg border border-blue-300 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-500 border-b border-blue-600 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <h1 className="text-lg sm:text-xl font-bold text-white uppercase tracking-wide">Điểm Danh Hằng Ngày</h1>
                    <span className="text-xs font-semibold text-cyan-100">Ngày máy chủ: {serverDate || '--'}</span>
                </div>

                <div className="p-4 sm:p-5 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="rounded border border-blue-200 bg-blue-50 px-3 py-2">
                            <div className="text-[11px] uppercase font-bold text-blue-600">Chuỗi hiện tại</div>
                            <div className="text-2xl font-black text-blue-800">{Number(checkIn.streak || 0)}</div>
                        </div>
                        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
                            <div className="text-[11px] uppercase font-bold text-emerald-600">Tổng lần điểm danh</div>
                            <div className="text-2xl font-black text-emerald-800">{Number(checkIn.totalClaims || 0)}</div>
                        </div>
                        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2">
                            <div className="text-[11px] uppercase font-bold text-amber-600">Quà kế tiếp</div>
                            <div className="text-2xl font-black text-amber-800">{toDayLabel(Number(checkIn.nextRewardDay || 1))}</div>
                        </div>
                    </div>

                    {checkIn.missed && (
                        <div className="px-3 py-2 rounded border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium">
                            Bạn đã bỏ lỡ nhịp điểm danh. Chuỗi sẽ bắt đầu lại từ ngày 1.
                        </div>
                    )}

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

                    <button
                        type="button"
                        disabled={!checkIn.canClaim || claiming}
                        onClick={handleClaim}
                        className={`w-full sm:w-auto px-5 py-2.5 rounded text-sm font-bold shadow-sm transition-colors ${checkIn.canClaim
                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                            : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                            }`}
                    >
                        {claiming ? 'Đang nhận quà...' : (checkIn.canClaim ? 'Nhận quà hôm nay' : 'Hôm nay đã điểm danh')}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-3">
                {rewards.map((reward) => {
                    const state = rewardStateByDay.get(Number(reward.day)) || 'pending'
                    const itemImage = reward?.item?.imageUrl || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png'
                    const pokemonImage = reward?.pokemon?.sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

                    return (
                        <div
                            key={reward.day}
                            className={`rounded-lg border shadow-sm p-3 transition-all flex flex-col h-full ${getRewardBadgeClass(state)} ${state === 'next' ? 'ring-2 ring-amber-200' : ''}`}
                        >
                            <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-wide whitespace-nowrap">
                                        {toDayLabel(reward.day)}
                                    </div>
                                    <div className="text-[10px] sm:text-[11px] mt-0.5 opacity-80 leading-tight">
                                        {reward.title || 'Quà đăng nhập'}
                                    </div>
                                </div>
                                <span className={`text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded border font-bold shrink-0 whitespace-nowrap ${state === 'claimed'
                                    ? 'bg-emerald-100 border-emerald-200 text-emerald-700'
                                    : state === 'next'
                                        ? 'bg-amber-100 border-amber-200 text-amber-700'
                                        : 'bg-slate-100 border-slate-200 text-slate-600'
                                    }`}>
                                    {state === 'claimed' ? 'Đã nhận' : state === 'next' ? 'Kế tiếp' : 'Chưa nhận'}
                                </span>
                            </div>

                            <div className="mt-auto flex flex-col items-center gap-2 text-center pt-2">
                                {reward.rewardType === 'item' ? (
                                    <img src={itemImage} alt={reward?.item?.name || 'Vật phẩm'} className="w-10 h-10 object-contain shrink-0" />
                                ) : reward.rewardType === 'pokemon' ? (
                                    <img src={pokemonImage} alt={reward?.pokemon?.name || 'Pokemon'} className="w-10 h-10 object-contain pixelated shrink-0" />
                                ) : (
                                    <div className="w-10 h-10 shrink-0 rounded-full bg-white border border-slate-200 flex items-center justify-center text-lg font-bold shadow-sm">
                                        {reward.rewardType === 'moonPoints' ? 'M' : 'P'}
                                    </div>
                                )}
                                <div className="text-[11px] sm:text-xs font-semibold leading-tight break-words w-full">
                                    {formatRewardText(reward)}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
