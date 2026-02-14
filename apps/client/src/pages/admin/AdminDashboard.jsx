import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { ADMIN_PERMISSIONS } from '../../constants/adminPermissions'

const ICONS = {
    pokemon: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png",
    map: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/town-map.png",
    items: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/bag.png",
    news: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/oaks-letter.png",
    users: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/vs-seeker.png",
    battle: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/focus-band.png",
    add: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/rare-candy.png"
}

const DashboardCard = ({ title, description, to, icon, color }) => {
    return (
        <Link
            to={to}
            className="group relative flex items-center p-3.5 bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md hover:border-blue-400 transition-all duration-200 h-full"
        >
            <div className={`w-12 h-12 flex-shrink-0 bg-${color}-50 rounded-lg flex items-center justify-center mr-3 group-hover:scale-105 transition-transform duration-200`}>
                <img src={icon} alt={title} className="w-7 h-7 object-contain pixelated" />
            </div>

            <div className="flex-1 min-w-0 py-0.5">
                <h3 className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">
                    {title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                    {description}
                </p>
            </div>

            <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity -translate-x-2 group-hover:translate-x-0">
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </div>
        </Link>
    )
}

const QuickStats = ({ label, value, color }) => (
    <div className="flex flex-row lg:flex-col justify-between lg:justify-center items-center p-2 lg:p-2.5 bg-slate-50 rounded-lg border border-slate-100">
        <span className="text-[10px] lg:text-[9px] uppercase font-bold text-slate-400 tracking-wider order-1 lg:order-2 lg:mt-1">{label}</span>
        <span className={`text-base lg:text-lg font-bold text-${color}-600 leading-none order-2 lg:order-1`}>{value}</span>
    </div>
)

export default function AdminDashboard() {
    const { canAccessAdminModule } = useAuth()


    const groups = [
        {
            title: 'Dữ Liệu Game',
            permissions: [ADMIN_PERMISSIONS.POKEMON, ADMIN_PERMISSIONS.MAPS, ADMIN_PERMISSIONS.ITEMS, ADMIN_PERMISSIONS.BATTLE],
            cards: [
                {
                    permission: ADMIN_PERMISSIONS.POKEMON,
                    title: 'Quản Lý Pokémon',
                    description: 'Danh sách, chỉ số, kỹ năng và tiến hóa',
                    to: '/admin/pokemon',
                    icon: ICONS.pokemon,
                    color: 'red',
                },
                {
                    permission: ADMIN_PERMISSIONS.ITEMS,
                    title: 'Quản Lý Vật Phẩm',
                    description: 'Danh sách, loại, độ hiếm và ảnh',
                    to: '/admin/items',
                    icon: ICONS.items,
                    color: 'amber',
                },
                {
                    permission: ADMIN_PERMISSIONS.MAPS,
                    title: 'Hệ Thống Bản Đồ',
                    description: 'Khu vực, tỉ lệ xuất hiện và sự kiện',
                    to: '/admin/maps',
                    icon: ICONS.map,
                    color: 'emerald',
                },
                {
                    permission: ADMIN_PERMISSIONS.BATTLE,
                    title: 'Quản Lý Battle',
                    description: 'Trainer AI, đội hình và phần thưởng',
                    to: '/admin/battle',
                    icon: ICONS.battle,
                    color: 'violet',
                },
            ]
        },
        {
            title: 'Vận Hành & Cộng Đồng',
            permissions: [ADMIN_PERMISSIONS.USERS, ADMIN_PERMISSIONS.NEWS],
            cards: [
                {
                    permission: ADMIN_PERMISSIONS.USERS,
                    title: 'Người Chơi',
                    description: 'Quản lý tài khoản và phân quyền admin',
                    to: '/admin/users',
                    icon: ICONS.users,
                    color: 'orange',
                },
                {
                    permission: ADMIN_PERMISSIONS.NEWS,
                    title: 'Tin Tức & Thông Báo',
                    description: 'Quản lý tin tức, sự kiện game và nhật ký',
                    to: '/admin/news',
                    icon: ICONS.news,
                    color: 'blue',
                },
                {
                    permission: ADMIN_PERMISSIONS.NEWS,
                    title: 'Cập Nhật Sidebar',
                    description: 'Quản lý mục mới cập nhật ở sidebar',
                    to: '/admin/events',
                    icon: ICONS.news,
                    color: 'cyan',
                },
            ]
        }
    ]

    const quickActions = [
        { permission: ADMIN_PERMISSIONS.POKEMON, to: '/admin/pokemon/create', label: 'Pokémon', className: 'bg-blue-600 hover:bg-blue-700' },
        { permission: ADMIN_PERMISSIONS.ITEMS, to: '/admin/items/create', label: 'Vật phẩm', className: 'bg-amber-500 hover:bg-amber-600' },
        { permission: ADMIN_PERMISSIONS.MAPS, to: '/admin/maps/create', label: 'Bản đồ', className: 'bg-emerald-600 hover:bg-emerald-700' },
    ].filter((action) => canAccessAdminModule(action.permission))

    return (
        <div className="max-w-6xl mx-auto space-y-5 bg-slate-50/50 p-6 rounded-3xl animate-fade-in relative z-0">
            <div className="flex justify-between items-center border-b border-slate-200 pb-5">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center">
                        <img src={ICONS.pokemon} className="w-7 h-7 pixelated" alt="Logo" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">
                            Trung Tâm Admin
                        </h1>
                        <p className="text-sm text-slate-500 font-medium">Hệ thống quản trị Pokemon World</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    {quickActions.map((action) => (
                        <Link key={action.to} to={action.to} className={`flex items-center gap-1.5 px-3 py-2 text-white rounded-xl text-xs font-bold transition-all shadow-sm hover:shadow active:scale-95 cursor-pointer whitespace-nowrap ${action.className}`}>
                            <span className="text-sm">+</span> {action.label}
                        </Link>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8 space-y-8">
                    {groups.map((group, groupIndex) => {
                        // Filter cards user has permission for
                        const visibleCards = group.cards.filter(card => canAccessAdminModule(card.permission));

                        // Hide section if no cards visible
                        if (visibleCards.length === 0) return null;

                        return (
                            <div key={groupIndex} className="space-y-3">
                                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                                    {group.title}
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {visibleCards.map((card) => (
                                        <DashboardCard key={card.to} {...card} />
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                </div>

                <div className="lg:col-span-4 flex flex-col gap-3">
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Trạng Thái Hệ Thống</h3>
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <QuickStats label="Máy chủ" value="ON" color="emerald" />
                            <QuickStats label="Phiên bản" value="1.0" color="blue" />
                            <QuickStats label="Độ trễ" value="24ms" color="emerald" />
                            <QuickStats label="Module" value={groups.reduce((acc, group) => acc + group.cards.length, 0)} color="slate" />
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-xl text-white shadow-md relative overflow-hidden group min-h-[100px] flex flex-col justify-center">
                        <div className="relative z-10 pr-8">
                            <h3 className="font-bold text-sm mb-0.5">Mẹo Quản Trị</h3>
                            <p className="text-indigo-100 text-[11px] leading-relaxed">
                                Kiểm tra quyền trước khi phân admin để tránh mở nhầm module nhạy cảm.
                            </p>
                        </div>
                        <img
                            src={ICONS.add}
                            className="absolute -bottom-3 -right-3 w-16 h-16 opacity-20 rotate-12 group-hover:rotate-45 group-hover:scale-110 transition-all duration-500 pixelated"
                            alt="Decoration"
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
