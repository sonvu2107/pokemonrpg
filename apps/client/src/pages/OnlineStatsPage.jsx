import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { gameApi } from '../services/gameApi'
import Modal from '../components/Modal'
import { resolvePokemonForm, resolvePokemonSprite } from '../utils/pokemonFormUtils'

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')
const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/132.png'

const formatProfileDate = (value, withTime = false) => {
    if (!value) return 'Không rõ'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Không rõ'
    return date.toLocaleString('vi-VN', withTime
        ? { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { year: 'numeric', month: 'long', day: 'numeric' })
}

const formatWinRate = (wins, losses) => {
    const total = Number(wins || 0) + Number(losses || 0)
    if (total <= 0) return '0%'
    return `${((Number(wins || 0) / total) * 100).toFixed(1)}%`
}

const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold px-4 py-2 text-center border-b border-blue-700 shadow-sm">
        {title}
    </div>
)

const ProfileSectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-400 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm">
        {title}
    </div>
)

const ProfileInfoRow = ({ label, value, isOdd }) => (
    <div className={`flex border-b border-blue-200 text-sm ${isOdd ? 'bg-blue-50/50' : 'bg-white'}`}>
        <div className="w-2/5 sm:w-1/3 p-2 bg-blue-100/50 font-semibold text-blue-900 border-r border-blue-200 flex items-center justify-end pr-3 sm:pr-4">
            {label}:
        </div>
        <div className="w-3/5 sm:w-2/3 p-2 text-slate-700 flex items-center font-medium break-words">
            {value}
        </div>
    </div>
)

const expToNext = (level) => 250 + Math.max(0, Number(level || 1) - 1) * 100
const PARTY_SLOT_TOTAL = 6

export default function OnlineStatsPage() {
    const navigate = useNavigate()
    const [wallet, setWallet] = useState({ platinumCoins: 0, moonPoints: 0 })
    const [onlineCount, setOnlineCount] = useState(0)
    const [onlineTrainers, setOnlineTrainers] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [featureNotice, setFeatureNotice] = useState('')
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1 })
    const [selectedTrainer, setSelectedTrainer] = useState(null)

    useEffect(() => {
        loadWallet()
        loadOnline(1)
    }, [])

    const loadWallet = async () => {
        try {
            const data = await gameApi.getProfile()
            setWallet({
                platinumCoins: Number(data?.playerState?.platinumCoins ?? 0),
                moonPoints: Number(data?.playerState?.moonPoints || 0),
            })
        } catch (_err) {
            setWallet({ platinumCoins: 0, moonPoints: 0 })
        }
    }

    const loadOnline = async (page = 1) => {
        try {
            setLoading(true)
            setError('')
            setFeatureNotice('')
            const data = await gameApi.getOnlineStats({ page, limit: 25 })
            setOnlineCount(Number(data?.onlineCount || 0))
            setOnlineTrainers(Array.isArray(data?.onlineTrainers) ? data.onlineTrainers : [])
            setPagination({
                page: Number(data?.pagination?.page || 1),
                totalPages: Number(data?.pagination?.totalPages || 1),
            })
        } catch (err) {
            setError(err.message || 'Không thể tải danh sách online')
        } finally {
            setLoading(false)
        }
    }

    const selectedProfile = selectedTrainer?.profile || {}
    const selectedLevel = Math.max(1, Number(selectedProfile.level || 1))
    const selectedExp = Number(selectedProfile.experience || 0)
    const selectedWins = Number(selectedProfile.wins || 0)
    const selectedLosses = Number(selectedProfile.losses || 0)
    const selectedSignature = String(selectedTrainer?.signature || '').trim()
    const selectedParty = Array.isArray(selectedTrainer?.party)
        ? selectedTrainer.party.slice(0, PARTY_SLOT_TOTAL)
        : []
    const paddedSelectedParty = [...selectedParty]
    while (paddedSelectedParty.length < PARTY_SLOT_TOTAL) {
        paddedSelectedParty.push(null)
    }
    const hasChallengeParty = paddedSelectedParty.some((slot) => Boolean(slot?._id))
    const challengeUserId = String(selectedTrainer?.userId || '').trim()
    const trainerProfileId = selectedTrainer?.userId
        ? `#${String(selectedTrainer.userId).slice(-7).toUpperCase()}`
        : (selectedTrainer?.userIdLabel || '???')

    const handleChallengeFromOnline = () => {
        if (!selectedTrainer) return

        if (!challengeUserId) {
            setFeatureNotice('Không tìm thấy userId để khiêu chiến online.')
            return
        }

        if (!hasChallengeParty) {
            setFeatureNotice(`Huấn luyện viên ${selectedTrainer.username || ''} chưa có Pokemon trong đội hình để khiêu chiến.`)
            return
        }

        setSelectedTrainer(null)
        navigate(`/battle?challengeUserId=${encodeURIComponent(challengeUserId)}&returnTo=${encodeURIComponent('stats/online')}`)
    }

    return (
        <div className="max-w-5xl mx-auto pb-12">
            <div className="text-center mb-5">
                <h1 className="text-3xl font-bold text-blue-900">Huấn luyện viên trực tuyến</h1>
                <div className="mt-2 text-sm text-slate-700 font-medium">
                    Hiện đang có <span className="font-bold text-blue-900">{formatNumber(onlineCount)}</span> huấn luyện viên online.
                </div>
            </div>

            {error && (
                <div className="mb-4 border border-red-300 bg-red-50 text-red-700 px-4 py-3 font-bold">
                    {error}
                </div>
            )}

            {featureNotice && (
                <div className="mb-4 border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 font-bold">
                    {featureNotice}
                </div>
            )}

            <div className="border border-blue-500 rounded overflow-hidden shadow-lg bg-white">
                <SectionHeader title="Danh sách đang online" />
                <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 text-sm font-bold text-slate-700 flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
                    <span>Xu Bạch Kim: <span className="text-blue-900">{formatNumber(wallet.platinumCoins)}</span></span>
                    <span>Điểm Nguyệt Các: <span className="text-blue-900">{formatNumber(wallet.moonPoints)}</span></span>
                </div>

                <div className="md:hidden">
                    {loading ? (
                        <div className="px-4 py-8 text-center text-slate-500 font-bold animate-pulse">Đang tải danh sách online...</div>
                    ) : onlineTrainers.length === 0 ? (
                        <div className="px-4 py-8 text-center text-slate-400 italic">Không có huấn luyện viên online</div>
                    ) : (
                        <div className="divide-y divide-blue-100">
                            {onlineTrainers.map((entry, index) => (
                                <div
                                    key={entry.userId || `${entry.rank}-${entry.username}`}
                                    className={`px-3 py-3 ${index % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs font-bold text-slate-600">{entry.userIdLabel}</span>
                                        <span className="text-xs text-slate-600">{entry.playTime}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedTrainer(entry)}
                                        className="mt-1 text-left text-sm font-bold text-indigo-800 hover:text-indigo-600 hover:underline break-all"
                                    >
                                        {entry.username}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="hidden md:block">
                    <table className="w-full text-sm table-fixed">
                        <thead>
                            <tr className="bg-blue-50 border-b border-blue-300">
                                <th className="px-3 py-3 text-center font-bold text-blue-900 w-24">Mã</th>
                                <th className="px-3 py-3 text-center font-bold text-blue-900">Người chơi</th>
                                <th className="px-3 py-3 text-center font-bold text-blue-900 w-40">Thời gian chơi</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="3" className="px-3 py-8 text-center text-slate-500 font-bold animate-pulse">Đang tải danh sách online...</td>
                                </tr>
                            ) : onlineTrainers.length === 0 ? (
                                <tr>
                                    <td colSpan="3" className="px-3 py-8 text-center text-slate-400 italic">Không có huấn luyện viên online</td>
                                </tr>
                            ) : (
                                onlineTrainers.map((entry, index) => (
                                    <tr
                                        key={entry.userId || `${entry.rank}-${entry.username}`}
                                        className={`border-b border-blue-100 ${index % 2 === 0 ? 'bg-white' : 'bg-blue-50/30'}`}
                                    >
                                        <td className="px-3 py-3 text-center font-bold text-slate-800">{entry.userIdLabel}</td>
                                        <td className="px-3 py-3 text-center">
                                            <button
                                                type="button"
                                                onClick={() => setSelectedTrainer(entry)}
                                                className="font-bold text-indigo-800 hover:text-indigo-600 hover:underline break-all"
                                            >
                                                {entry.username}
                                            </button>
                                        </td>
                                        <td className="px-3 py-3 text-center text-slate-700">{entry.playTime}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <Modal
                isOpen={Boolean(selectedTrainer)}
                onClose={() => setSelectedTrainer(null)}
                title="Thông tin huấn luyện viên"
                maxWidth="md"
            >
                {selectedTrainer && (
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <ProfileSectionHeader title={`Hồ sơ của ${selectedTrainer.username || 'Huấn Luyện Viên'}`} />
                        <div className="bg-blue-50/50 p-4 text-center">
                            <div className="max-w-2xl mx-auto">
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-4 shadow-sm">
                                    Ảnh Đại Diện
                                </div>
                                <div className="mx-auto w-28 h-28 mb-4 flex items-center justify-center">
                                    <img
                                        src={selectedTrainer.avatar || DEFAULT_AVATAR}
                                        alt={selectedTrainer.username || 'Huấn luyện viên'}
                                        className="h-full object-contain pixelated drop-shadow-md"
                                        onError={(event) => {
                                            event.currentTarget.onerror = null
                                            event.currentTarget.src = DEFAULT_AVATAR
                                        }}
                                    />
                                </div>
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                                    Hành Động
                                </div>
                                <div className="flex justify-center gap-2 text-xs font-bold text-blue-700 mb-4 px-4">
                                    <button
                                        type="button"
                                        onClick={handleChallengeFromOnline}
                                        disabled={!challengeUserId || !hasChallengeParty}
                                        className="px-3 py-1 rounded border border-blue-300 bg-white text-blue-800 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        [ Khiêu Chiến ]
                                    </button>
                                </div>
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                                    Trạng Thái
                                </div>
                                <div className="py-2 text-sm text-slate-700">
                                    <span className="font-bold text-slate-900">{selectedTrainer.username || 'Huấn Luyện Viên'}</span> hiện đang{' '}
                                    <span className={`font-bold ${selectedTrainer.isOnline ? 'text-green-600' : 'text-slate-500'}`}>
                                        {selectedTrainer.isOnline ? 'Trực Tuyến' : 'Ngoại Tuyến'}
                                    </span>.
                                </div>
                                <div className="text-xs text-slate-500">
                                    Hoạt động gần nhất: {formatProfileDate(selectedTrainer.lastActive, true)}
                                </div>
                            </div>
                        </div>

                        <div className="bg-white border-t border-blue-200">
                            <ProfileSectionHeader title="Thông Tin Người Chơi" />
                            <div className="bg-white">
                                <ProfileInfoRow label="ID Người Chơi" value={trainerProfileId} isOdd={false} />
                                <ProfileInfoRow label="Tên Nhân Vật" value={selectedTrainer.username || 'Huấn Luyện Viên'} isOdd={true} />
                                <ProfileInfoRow label="Nhóm" value={selectedTrainer.role === 'admin' ? 'Quản Trị Viên' : 'Thành Viên'} isOdd={false} />
                                <ProfileInfoRow label="Cấp Người Chơi" value={`Lv. ${formatNumber(selectedLevel)}`} isOdd={true} />
                                <ProfileInfoRow
                                    label="Kinh Nghiệm"
                                    value={`${formatNumber(selectedExp)} EXP (Thiếu ${formatNumber(expToNext(selectedLevel))} EXP để lên cấp)`}
                                    isOdd={false}
                                />
                                <ProfileInfoRow label="HP" value={`${formatNumber(selectedProfile.hp)}/${formatNumber(selectedProfile.maxHp)} HP`} isOdd={true} />
                                <ProfileInfoRow label="Thể Lực" value={`${formatNumber(selectedProfile.stamina)}/${formatNumber(selectedProfile.maxStamina)} AP`} isOdd={false} />
                                <ProfileInfoRow label="Xu Bạch Kim" value={`${formatNumber(selectedProfile.platinumCoins)} Xu`} isOdd={true} />
                                <ProfileInfoRow label="Điểm Nguyệt Các" value={`${formatNumber(selectedProfile.moonPoints)} Điểm`} isOdd={false} />
                                <ProfileInfoRow label="Trận Đấu" value={`${formatNumber(selectedWins)} thắng - ${formatNumber(selectedLosses)} thua`} isOdd={true} />
                                <ProfileInfoRow label="Tỷ Lệ Thắng" value={formatWinRate(selectedWins, selectedLosses)} isOdd={false} />
                                <ProfileInfoRow label="Thời Gian Chơi" value={selectedTrainer.playTime || 'Không rõ'} isOdd={true} />
                                <ProfileInfoRow label="Ngày Đăng Ký" value={formatProfileDate(selectedTrainer.createdAt)} isOdd={false} />
                                <ProfileInfoRow label="Hoạt Động Gần Nhất" value={formatProfileDate(selectedTrainer.lastActive, true)} isOdd={true} />
                            </div>
                        </div>

                        <div className="bg-white border-t border-blue-200">
                            <ProfileSectionHeader title="Đội Hình" />
                            <div className="bg-slate-100 min-h-[160px] flex items-stretch divide-x divide-blue-200 border-b border-blue-200 overflow-x-auto">
                                {paddedSelectedParty.map((p, i) => {
                                    if (!p) {
                                        return (
                                            <div key={`empty-${i}`} className="min-w-[16.66%] flex-1 flex flex-col items-center justify-center gap-2 p-3 bg-slate-50">
                                                <div className="w-14 h-14 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-300 text-lg font-bold">
                                                    {i + 1}
                                                </div>
                                                <span className="text-[10px] text-slate-400 font-medium">Trống</span>
                                            </div>
                                        )
                                    }

                                    const species = p.pokemonId || {}
                                    const { formId, formName } = resolvePokemonForm(species, p.formId)
                                    const sprite = resolvePokemonSprite({
                                        species,
                                        formId,
                                        isShiny: Boolean(p.isShiny),
                                        fallback: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png',
                                    })
                                    const displayName = p.nickname || species.name || 'Unknown'

                                    return (
                                        <Link
                                            to={`/pokemon/${p._id}`}
                                            key={p._id || `slot-${i}`}
                                            className="min-w-[16.66%] flex-1 flex flex-col items-center justify-between py-3 px-2 bg-white hover:bg-blue-50 transition-colors group border-t-2 border-t-transparent hover:border-t-blue-400"
                                        >
                                            <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold truncate max-w-full text-center">
                                                {species.name || '???'}
                                            </span>
                                            {displayName && displayName !== species.name ? (
                                                <span className="font-bold text-blue-900 text-xs truncate max-w-[80px] text-center group-hover:text-blue-600 transition-colors">
                                                    {displayName}
                                                </span>
                                            ) : (
                                                <span className="invisible text-xs">-</span>
                                            )}
                                            <div className="relative w-20 h-20 flex items-center justify-center my-1">
                                                <img
                                                    src={sprite || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'}
                                                    className="max-w-full max-h-full pixelated rendering-pixelated group-hover:scale-110 transition-transform duration-200 drop-shadow-md"
                                                    onError={(event) => {
                                                        event.currentTarget.onerror = null
                                                        event.currentTarget.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                                    }}
                                                />
                                                {p.isShiny && (
                                                    <span className="absolute -top-1 -right-1 text-amber-400 text-sm drop-shadow-sm">★</span>
                                                )}
                                            </div>
                                            <span className="text-xs text-amber-600 font-bold">Lv. {formatNumber(p.level)}</span>
                                            {formId !== 'normal' && (
                                                <span className="text-[9px] bg-sky-100 text-sky-700 font-bold px-1.5 py-0.5 rounded-full border border-sky-200">
                                                    {formName}
                                                </span>
                                            )}
                                        </Link>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="bg-white border-t border-blue-200">
                            <ProfileSectionHeader title="Chữ Ký" />
                            <div className={`p-4 text-center text-sm ${selectedSignature ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                                {selectedSignature || 'Chưa có chữ ký'}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {pagination.totalPages > 1 && (
                <div className="mt-3 flex items-center justify-center gap-2 text-sm font-bold">
                    <button
                        onClick={() => loadOnline(Math.max(1, pagination.page - 1))}
                        disabled={pagination.page <= 1 || loading}
                        className="px-3 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40"
                    >
                        Trước
                    </button>
                    <span className="text-slate-700">Trang {pagination.page}/{pagination.totalPages}</span>
                    <button
                        onClick={() => loadOnline(Math.min(pagination.totalPages, pagination.page + 1))}
                        disabled={pagination.page >= pagination.totalPages || loading}
                        className="px-3 py-1 rounded bg-blue-100 text-blue-800 hover:bg-blue-200 disabled:opacity-40"
                    >
                        Sau
                    </button>
                </div>
            )}
        </div>
    )
}
