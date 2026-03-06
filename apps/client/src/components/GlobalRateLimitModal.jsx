import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { GLOBAL_RATE_LIMIT_EVENT } from '../utils/rateLimitWatcher'

const formatRetryLabel = (seconds = 0) => {
    const normalized = Math.max(0, Number(seconds) || 0)
    if (normalized <= 0) return 'vài giây'
    if (normalized < 60) return `${normalized} giây`
    const minutes = Math.floor(normalized / 60)
    const remainSeconds = normalized % 60
    if (remainSeconds === 0) return `${minutes} phút`
    return `${minutes} phút ${remainSeconds} giây`
}

export default function GlobalRateLimitModal() {
    const [isOpen, setIsOpen] = useState(false)
    const [message, setMessage] = useState('Giáo sư Oak: Bạn thao tác hơi nhanh. Hãy nghỉ một chút rồi tiếp tục hành trình.')
    const [remainingSeconds, setRemainingSeconds] = useState(0)

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        const handleGlobalRateLimit = (event) => {
            const detail = event?.detail || {}
            const nextMessage = String(detail?.message || 'Bạn đã chạm giới hạn yêu cầu. Vui lòng chờ rồi thử lại.').trim()
            const nextSeconds = Math.max(0, Number(detail?.retryAfterSeconds || 0))

            setMessage(nextMessage)
            setRemainingSeconds(nextSeconds)
            setIsOpen(true)
        }

        window.addEventListener(GLOBAL_RATE_LIMIT_EVENT, handleGlobalRateLimit)
        return () => {
            window.removeEventListener(GLOBAL_RATE_LIMIT_EVENT, handleGlobalRateLimit)
        }
    }, [])

    useEffect(() => {
        if (!isOpen || remainingSeconds <= 0) return undefined

        const timerId = window.setInterval(() => {
            setRemainingSeconds((prev) => {
                const next = Math.max(0, prev - 1)
                return next
            })
        }, 1000)

        return () => {
            window.clearInterval(timerId)
        }
    }, [isOpen, remainingSeconds])

    const waitLabel = useMemo(() => formatRetryLabel(remainingSeconds), [remainingSeconds])

    return (
            <Modal
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            title="Liên lạc từ Giáo sư Oak"
            maxWidth="sm"
        >
            <div className="flex flex-col items-center text-center gap-4 py-2">
                <div className="relative">
                    <img
                        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png"
                        alt="Pikachu"
                        className="w-24 h-24 object-contain drop-shadow-lg"
                    />
                    <img
                        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                        alt="Pokeball"
                        className="w-8 h-8 pixelated absolute -right-3 -bottom-1 animate-bounce"
                    />
                </div>

                <div className="w-full rounded-xl border-[3px] border-slate-800 bg-gradient-to-b from-slate-100 to-slate-200 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.65)] px-3 py-3">
                    <div className="rounded-md border-2 border-emerald-900 bg-emerald-950 px-3 py-2 text-left font-mono">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">Pokeboy Link</p>
                        <p className="mt-1 text-sm leading-relaxed text-emerald-100">{message}</p>
                    </div>
                    <p className="mt-3 text-xs font-black text-orange-700 uppercase tracking-[0.08em]">
                        Kết nối lại sau: {waitLabel}
                    </p>
                </div>

                <button
                    onClick={() => setIsOpen(false)}
                    className="px-7 py-2.5 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-bold shadow-md transition-all active:scale-95"
                >
                    Đã hiểu
                </button>
            </div>
        </Modal>
    )
}
