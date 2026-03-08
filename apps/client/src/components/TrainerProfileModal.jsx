import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from './Modal'
import { resolvePokemonForm, resolvePokemonSprite } from '../utils/pokemonFormUtils'
import VipAvatar from './VipAvatar'
import VipTitleBadge from './VipTitleBadge'
import { getPublicRoleLabel } from '../utils/vip'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'
const PARTY_SLOT_TOTAL = 6

const formatNumber = (value) => Number(value || 0).toLocaleString('vi-VN')
const resolvePokemonCombatPower = (entry) => {
    const raw = Number(entry?.combatPower ?? entry?.power)
    if (Number.isFinite(raw) && raw > 0) return Math.floor(raw)
    const level = Math.max(1, Number(entry?.level || 1))
    return level * 10
}

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

const expToNext = (level) => 250 + Math.max(0, Number(level || 1) - 1) * 100

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

export default function TrainerProfileModal({
    isOpen,
    trainer,
    onClose,
    notice,
    detailError,
    loadingDetail,
    sendingFriendRequest,
    isSelfTrainer,
    hasChallengeParty,
    onSendFriendRequest,
    onChallenge,
}) {
    const [showParty, setShowParty] = useState(true)

    useEffect(() => {
        if (isOpen) {
            setShowParty(true)
        }
    }, [isOpen, trainer?.userId])

    if (!isOpen || !trainer) return null

    const selectedProfile = trainer?.profile || {}
    const selectedLevel = Math.max(1, Number(selectedProfile.level || 1))
    const selectedExp = Number(selectedProfile.experience || 0)
    const selectedWins = Number(selectedProfile.wins || 0)
    const selectedLosses = Number(selectedProfile.losses || 0)
    const selectedSignature = String(trainer?.signature || '').trim()

    const selectedParty = Array.isArray(trainer?.party)
        ? trainer.party.slice(0, PARTY_SLOT_TOTAL)
        : []
    const paddedSelectedParty = [...selectedParty]
    while (paddedSelectedParty.length < PARTY_SLOT_TOTAL) {
        paddedSelectedParty.push(null)
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Thông tin huấn luyện viên"
            maxWidth="md"
        >
            <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                <ProfileSectionHeader title={`Hồ sơ của ${trainer.username || 'Huấn Luyện Viên'}`} />
                <div className="bg-blue-50/50 p-4 text-center">
                    <div className="max-w-2xl mx-auto">
                        <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-4 shadow-sm">
                            Ảnh đại diện
                        </div>
                        <div className="mx-auto w-28 h-28 mb-4 flex items-center justify-center">
                            <VipAvatar
                                userLike={trainer}
                                avatar={trainer.avatar}
                                fallback={DEFAULT_AVATAR}
                                alt={trainer.username || 'Huấn luyện viên'}
                                wrapperClassName="w-full h-full"
                                imageClassName="h-full w-full object-contain pixelated drop-shadow-md"
                                frameClassName="h-full w-full object-cover rounded-full"
                                loading="eager"
                            />
                        </div>
                        <div className="mb-3 flex flex-col items-center gap-1">
                            <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">Danh hiệu VIP</div>
                            <VipTitleBadge userLike={trainer} fallback="dash" />
                        </div>
                        <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                            Hành động
                        </div>

                        <div className="flex justify-center gap-2 text-xs font-bold text-blue-700 mb-4 px-4 flex-wrap">
                            {isSelfTrainer ? (
                                <span className="px-3 py-1 rounded border border-slate-300 bg-slate-100 text-slate-600">Bạn đang xem hồ sơ của chính mình</span>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={onSendFriendRequest}
                                        disabled={sendingFriendRequest}
                                        className="px-3 py-1 rounded border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {sendingFriendRequest ? '[ Đang gửi... ]' : '[ Kết bạn ]'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onChallenge}
                                        disabled={!hasChallengeParty}
                                        className="px-3 py-1 rounded border border-blue-300 bg-white text-blue-800 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        [ Khiêu chiến ]
                                    </button>
                                </>
                            )}
                        </div>

                        {notice && (
                            <div className="mb-3 border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 text-xs font-bold rounded">
                                {notice}
                            </div>
                        )}

                        <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                            Trạng thái
                        </div>
                        <div className="py-2 text-sm text-slate-700">
                            <span className="font-bold text-slate-900">{trainer.username || 'Huấn Luyện Viên'}</span> hiện đang{' '}
                            <span className={`font-bold ${trainer.isOnline ? 'text-green-600' : 'text-slate-500'}`}>
                                {trainer.isOnline ? 'Trực tuyến' : 'Ngoại tuyến'}
                            </span>.
                        </div>
                        <div className="text-xs text-slate-500">
                            Hoạt động gần nhất: {formatProfileDate(trainer.lastActive, true)}
                        </div>

                        {loadingDetail && (
                            <div className="mt-3 text-xs font-bold text-blue-700 animate-pulse">Đang tải chi tiết hồ sơ...</div>
                        )}

                        {detailError && (
                            <div className="mt-3 text-xs font-bold text-rose-700">{detailError}</div>
                        )}
                    </div>
                </div>

                <div className="bg-white border-t border-blue-200">
                    <ProfileSectionHeader title="Thông tin người chơi" />
                    <div className="bg-white">
                        <ProfileInfoRow label="ID Người Chơi" value={trainer.userIdLabel || '???'} isOdd={false} />
                        <ProfileInfoRow label="Tên Nhân Vật" value={trainer.username || 'Huấn Luyện Viên'} isOdd={true} />
                        <ProfileInfoRow label="Nhóm" value={getPublicRoleLabel(trainer)} isOdd={false} />
                        <ProfileInfoRow label="Danh hiệu VIP" value={<VipTitleBadge userLike={trainer} fallback="dash" />} isOdd={true} />
                        <ProfileInfoRow label="Cấp Người Chơi" value={`Lv. ${formatNumber(selectedLevel)}`} isOdd={false} />
                        <ProfileInfoRow
                            label="Kinh Nghiệm"
                            value={`${formatNumber(selectedExp)} EXP (Thiếu ${formatNumber(expToNext(selectedLevel))} EXP để lên cấp)`}
                            isOdd={true}
                        />
                        <ProfileInfoRow label="HP" value={`${formatNumber(selectedProfile.hp)}/${formatNumber(selectedProfile.maxHp)} HP`} isOdd={false} />
                        <ProfileInfoRow label="Thể Lực" value={`${formatNumber(selectedProfile.stamina)}/${formatNumber(selectedProfile.maxStamina)} AP`} isOdd={true} />
                        <ProfileInfoRow label="Xu Bạch Kim" value={`${formatNumber(selectedProfile.platinumCoins)} Xu`} isOdd={false} />
                        <ProfileInfoRow label="Điểm Nguyệt Các" value={`${formatNumber(selectedProfile.moonPoints)} Điểm`} isOdd={true} />
                        <ProfileInfoRow label="Trận Đấu" value={`${formatNumber(selectedWins)} thắng - ${formatNumber(selectedLosses)} thua`} isOdd={false} />
                        <ProfileInfoRow label="Tỷ Lệ Thắng" value={formatWinRate(selectedWins, selectedLosses)} isOdd={true} />
                        <ProfileInfoRow label="Thời Gian Chơi" value={trainer.playTime || 'Không rõ'} isOdd={false} />
                        <ProfileInfoRow label="Ngày Đăng Ký" value={formatProfileDate(trainer.createdAt)} isOdd={true} />
                        <ProfileInfoRow label="Hoạt Động Gần Nhất" value={formatProfileDate(trainer.lastActive, true)} isOdd={false} />
                    </div>
                </div>

                <div className="bg-white border-t border-blue-200">
                    <ProfileSectionHeader title="Đội Hình" />
                    <div className="flex items-center justify-between gap-3 border-b border-blue-200 bg-blue-50 px-3 py-2">
                        <div className="text-xs font-medium text-slate-500">
                            {showParty ? 'Đội hình đang được hiển thị trong modal hồ sơ.' : 'Đội hình hiện đang được thu gọn.'}
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowParty((prev) => !prev)}
                            className="shrink-0 rounded border border-blue-300 bg-white px-3 py-1 text-xs font-bold text-blue-800 transition-colors hover:bg-blue-100"
                        >
                            {showParty ? '[ Ẩn Đội Hình ]' : '[ Hiện Đội Hình ]'}
                        </button>
                    </div>
                    {showParty ? (
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
                                const { formId } = resolvePokemonForm(species, p.formId)
                                const sprite = resolvePokemonSprite({
                                    species,
                                    formId,
                                    isShiny: Boolean(p.isShiny),
                                    fallback: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png',
                                })
                                const displayName = p.nickname || species.name || 'Unknown'
                                const combatPower = resolvePokemonCombatPower(p)

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
                                        <span className="text-[11px] text-rose-600 font-bold">LC: {formatNumber(combatPower)}</span>
                                    </Link>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="border-b border-blue-200 bg-slate-50 px-4 py-8 text-center text-sm italic text-slate-500">
                            Nhấn "Hiện Đội Hình" để mở lại phần đội hình của huấn luyện viên.
                        </div>
                    )}
                </div>

                <div className="bg-white border-t border-blue-200">
                    <ProfileSectionHeader title="Chữ Ký" />
                    <div className={`p-4 text-center text-sm ${selectedSignature ? 'text-slate-700' : 'text-slate-400 italic'}`}>
                        {selectedSignature || 'Chưa có chữ ký'}
                    </div>
                </div>
            </div>
        </Modal>
    )
}
