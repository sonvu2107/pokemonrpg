import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import { gameApi } from '../services/gameApi'

const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

// Helper component for section headers with the blue gradient style
const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-400 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm">
        {title}
    </div>
)

// Helper for Info Table Rows
const InfoRow = ({ label, value, note, isOdd }) => (
    <div className={`flex border-b border-blue-200 text-sm ${isOdd ? 'bg-blue-50/50' : 'bg-white'}`}>
        <div className="w-1/3 p-2 bg-blue-100/50 font-semibold text-blue-900 border-r border-blue-200 flex items-center justify-end pr-4">
            {label}:
        </div>
        <div className="w-2/3 p-2 text-slate-700 flex items-center font-medium">
            {value}
            {note && <span className="ml-1 text-slate-500 text-xs font-normal">{note}</span>}
        </div>
    </div>
)

export default function ProfilePage() {
    const { login } = useAuth()
    const [profile, setProfile] = useState(null)
    const [party, setParty] = useState(Array(6).fill(null))
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [refreshing, setRefreshing] = useState(false)

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        try {
            setLoading(true)
            const [profileData, partyData] = await Promise.all([
                api.getProfile(),
                gameApi.getParty()
            ])

            setProfile(profileData)
            setParty(partyData)

            // Update AuthContext with fresh data
            if (profileData.user) {
                const token = localStorage.getItem('token')
                login(profileData.user, token)
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleRefresh = async () => {
        setRefreshing(true)
        await loadData()
        setRefreshing(false)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="text-slate-400 font-bold animate-pulse">Đang tải hồ sơ...</div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="max-w-md mx-auto mt-8 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                <p>Lỗi: {error}</p>
                <button
                    onClick={loadData}
                    className="mt-2 px-4 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                >
                    Thử lại
                </button>
            </div>
        )
    }

    const { user, playerState } = profile || {}
    const username = user?.username || 'Huấn Luyện Viên'
    const joinDate = user?.createdAt ? new Date(user.createdAt).toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Không rõ'
    const coins = playerState?.gold || 0
    const moonPoints = playerState?.moonPoints || 0
    const level = playerState?.level || 1
    const exp = playerState?.experience || 0
    const stamina = playerState?.stamina || 0
    const maxStamina = playerState?.maxStamina || 100
    const wins = playerState?.wins || 0
    const losses = playerState?.losses || 0
    const avatarSrc = String(user?.avatar || '').trim() || DEFAULT_AVATAR

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12">
            {/* Top Header Area */}
            <div className="text-center mb-6">
                <h1 className="text-4xl font-bold text-slate-800 mb-2 drop-shadow-sm tracking-tight">{username}</h1>
                <div className="flex justify-center gap-6 text-sm font-bold text-slate-500">
                    <div className="flex items-center gap-1 text-slate-700 drop-shadow-sm">
                        <span>🪙 {coins.toLocaleString()} Xu Bạch Kim</span>
                    </div>
                    <div className="flex items-center gap-1 text-slate-600">
                        <span>🌑 {moonPoints.toLocaleString()} Điểm Nguyệt Các</span>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs Bar */}
            <div className="rounded-t-lg overflow-hidden border border-blue-500 shadow-lg bg-slate-800">
                <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold py-1 px-4 text-center border-b border-blue-600">
                    Menu Hồ Sơ
                </div>
                <div className="bg-blue-50 border-b border-blue-300 p-2 flex flex-wrap justify-center gap-1 text-xs font-bold text-blue-700">
                    {['Cá Nhân', 'Đội Hình', 'Kho', 'Hầm Mỏ', 'Túi Đồ', 'Thú Bông', 'Đồ Hiếm', 'Danh Hiệu'].map(tab => (
                        <button key={tab} className="hover:text-amber-600 hover:underline px-2 transition-colors">
                            [ {tab} ]
                        </button>
                    ))}
                </div>

                <div className="bg-white p-2 sm:p-4 space-y-6">

                    {/* PROFILE CARD */}
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <SectionHeader title={`Hồ sơ của ${username}`} />

                        <div className="bg-blue-50/50 p-4 text-center">
                            {/* Sub-header: Trainer Avatar */}
                            <div className="max-w-2xl mx-auto">
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-4 shadow-sm">
                                    Ảnh Đại Diện
                                </div>

                                {/* Avatar Display */}
                                <div className="mx-auto w-32 h-32 mb-6 flex items-center justify-center">
                                    <img
                                        src={avatarSrc}
                                        alt="Trainer Avatar"
                                        className="h-full object-contain pixelated drop-shadow-md"
                                        onError={(e) => {
                                            e.currentTarget.onerror = null
                                            e.currentTarget.src = DEFAULT_AVATAR
                                        }}
                                    />
                                </div>

                                {/* Sub-header: Account Actions */}
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                                    Hành Động
                                </div>
                                <div className="flex flex-wrap justify-center gap-2 text-xs font-bold text-blue-700 mb-6 px-4">
                                    <Link to="/profile/edit" className="hover:text-amber-600 hover:underline px-1 whitespace-nowrap text-blue-800">
                                        [ Chỉnh Sửa ]
                                    </Link>
                                    {['Gửi Tin Nhắn', 'Chuyển Tiền', 'Thách Đấu'].map(action => (
                                        <button key={action} className="hover:text-amber-600 hover:underline px-1 whitespace-nowrap">
                                            [ {action} ]
                                        </button>
                                    ))}
                                    <div className="w-full hidden sm:block"></div> {/* Break line on desktop if needed, or flex wrap handles it */}
                                    {['Giới Thiệu', 'Thống Kê Ngày', 'Kho Đầy Đủ', 'Pokemon Đã Bán', 'Thú Bông'].map(action => (
                                        <button key={action} className="hover:text-amber-600 hover:underline px-1 whitespace-nowrap">
                                            [ {action} ]
                                        </button>
                                    ))}
                                    {/* Add Refresh Button here explicitly as an action */}
                                    <button onClick={handleRefresh} className="hover:text-amber-600 hover:underline px-1 whitespace-nowrap text-blue-800">
                                        [ Làm Mới Hồ Sơ ]
                                        {refreshing && <span className="ml-1 animate-spin inline-block">↻</span>}
                                    </button>
                                </div>

                                {/* Sub-header: Online Status */}
                                <div className="bg-gradient-to-b from-blue-100 to-white border border-blue-200 text-blue-900 font-bold py-1 px-4 mb-2 shadow-sm">
                                    Trạng Thái
                                </div>
                                <div className="py-2 text-sm text-slate-700">
                                    <span className="font-bold text-slate-900">{username}</span> hiện đang <span className="text-green-600 font-bold">Trực Tuyến</span>.
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* PARTY SECTION */}
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <SectionHeader title="Đội Hình" />
                        <div className="bg-slate-100 min-h-[100px] flex items-stretch divide-x divide-gray-300 border-b border-gray-300 overflow-x-auto">
                            {/* Party Members */}
                            {party.map((p, i) => {
                                if (!p) {
                                    return (
                                        <div key={i} className="min-w-[16.66%] flex-1 bg-slate-100 flex items-center justify-center p-2">
                                            <div className="w-8 h-8 rounded-full bg-slate-200/50 flex items-center justify-center text-slate-300 text-xs">
                                                {i + 1}
                                            </div>
                                        </div>
                                    )
                                }
                                const species = p.pokemonId || {}
                                const sprite = p.isShiny ? (species.sprites?.shiny || species.imageUrl) : (species.imageUrl || species.sprites?.normal)
                                const name = p.nickname || species.name || 'Unknown'

                                return (
                                    <Link
                                        to={`/pokemon/${p._id}`}
                                        key={p._id}
                                        className="min-w-[16.66%] flex-1 flex flex-col items-center justify-center p-2 bg-slate-50 hover:bg-white transition-colors group"
                                    >
                                        <span className="text-[10px] text-slate-500 mb-1 uppercase tracking-tighter">{species.name}</span>
                                        <span className="font-bold text-blue-900 text-xs mb-1 truncate max-w-[80px] text-center group-hover:text-blue-600">{name}</span>
                                        <div className="relative w-12 h-12 flex items-center justify-center">
                                            <img
                                                src={sprite || '/placeholder.png'}
                                                className="max-w-full max-h-full pixelated rendering-pixelated group-hover:scale-110 transition-transform"
                                                onError={(e) => {
                                                    e.target.onerror = null;
                                                    e.target.src = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/0.png'
                                                }}
                                            />
                                            {p.isShiny && <span className="absolute top-0 right-0 text-[8px] text-amber-500 font-bold">★</span>}
                                        </div>
                                        <span className="text-xs text-amber-600 font-bold mt-1">Lv. {p.level}</span>
                                    </Link>
                                )
                            })}
                        </div>
                    </div>

                    {/* USER INFO TABLE */}
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <SectionHeader title="Thông Tin Người Chơi" />
                        <div className="bg-white">
                            <InfoRow label="ID Người Chơi" value={`#${user?.id ? user.id.slice(-7).toUpperCase() : '???'}`} isOdd={false} />
                            <InfoRow label="Tên Nhân Vật" value={username} isOdd={true} />
                            <InfoRow label="Danh Hiệu" value="Tân Thủ" isOdd={false} />
                            <InfoRow label="Giới Tính" value="Nam" isOdd={true} />
                            <InfoRow label="Nhóm" value={user?.role === 'admin' ? 'Quản Trị Viên' : 'Thành Viên'} isOdd={false} />
                            <InfoRow label="Cấp Bản Đồ" value="Lv. 1" isOdd={true} />
                            <InfoRow label="Cấp Người Chơi" value={`Lv. ${level}`} isOdd={false} />
                            <InfoRow label="Kinh Nghiệm" value={`${exp.toLocaleString()} EXP (${expToNext(level).toLocaleString()} để lên cấp)`} isOdd={true} />
                            <InfoRow label="Cấp Đào Mỏ" value="Lv. 1" isOdd={false} />
                            <InfoRow label="Xu Bạch Kim" value={`$${coins.toLocaleString()}`} isOdd={true} />
                            <InfoRow label="Điểm Nguyệt Các" value={`${moonPoints.toLocaleString()} Điểm`} isOdd={false} />
                            <InfoRow label="Thể Lực" value={`${stamina}/${maxStamina} AP`} isOdd={true} />
                            <InfoRow label="Trận Thắng" value={`${wins} thắng - ${losses} thua`} isOdd={false} />
                            <InfoRow label="Ngày Đăng Ký" value={joinDate} isOdd={true} />
                            <InfoRow label="Đăng Nhập Cuối" value={new Date().toLocaleDateString('vi-VN')} isOdd={false} help="Mocked for now" />
                            <InfoRow label="Thời Gian Chơi" value="Không rõ" isOdd={true} />
                            <InfoRow label="Phiên Bản" value="Beta 1.0" isOdd={false} />
                        </div>
                        <div className="bg-white border-t border-blue-200">
                            <SectionHeader title="Chữ Ký" />
                            <div className="p-4 text-center text-slate-400 italic text-sm">
                                Chưa có chữ ký
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    )
}

const expToNext = (level) => 250 + Math.max(0, level - 1) * 100
