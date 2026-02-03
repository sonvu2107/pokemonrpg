import { Link } from 'react-router-dom'

// Pokemon Icon URLs (using official sprites for authenticity)
const ICONS = {
    pokemon: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png",
    map: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/town-map.png",
    news: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/oaks-letter.png",
    users: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/vs-seeker.png",
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
    <div className="flex flex-col items-center justify-center p-2.5 bg-slate-50 rounded-lg border border-slate-100 h-full">
        <span className={`text-lg font-bold text-${color}-600 leading-none`}>{value}</span>
        <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider mt-1">{label}</span>
    </div>
)

export default function AdminDashboard() {
    return (
        <div className="max-w-5xl mx-auto space-y-5 bg-slate-50/50 p-5 rounded-3xl animate-fade-in relative z-0">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center">
                        <img src={ICONS.pokemon} className="w-6 h-6 pixelated" alt="Logo" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                            Admin Center
                        </h1>
                        <p className="text-xs text-slate-500 font-medium">Hệ thống quản trị Pokemon World</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Link to="/admin/pokemon/create" className="flex items-center gap-1 md:gap-1.5 px-2 py-1 md:px-3 md:py-1.5 bg-blue-600 text-white rounded-lg text-[10px] md:text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm cursor-pointer whitespace-nowrap">
                        <span className="text-xs md:text-sm">+</span> Pokemon
                    </Link>
                    <Link to="/admin/maps/create" className="flex items-center gap-1 md:gap-1.5 px-2 py-1 md:px-3 md:py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] md:text-xs font-bold hover:bg-emerald-700 transition-colors shadow-sm cursor-pointer whitespace-nowrap">
                        <span className="text-xs md:text-sm">+</span> Bản Đồ
                    </Link>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

                {/* Main Menu Grid - Takes 8/12 columns */}
                <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3 auto-rows-fr">
                    <DashboardCard
                        title="Quản Lý Pokemon"
                        description="Danh sách, chỉ số, kỹ năng & tiến hóa"
                        to="/admin/pokemon"
                        icon={ICONS.pokemon}
                        color="red"
                    />
                    <DashboardCard
                        title="Hệ Thống Bản Đồ"
                        description="Khu vực, tỷ lệ xuất hiện & sự kiện"
                        to="/admin/maps"
                        icon={ICONS.map}
                        color="emerald"
                    />
                    <DashboardCard
                        title="Người Chơi"
                        description="Quản lý tài khoản, quyền hạn & dữ liệu"
                        to="/admin/users"
                        icon={ICONS.users}
                        color="orange"
                    />
                    <DashboardCard
                        title="Tin Tức & Sự Kiện"
                        description="Thông báo, sự kiện game & nhật ký"
                        to="/admin/news"
                        icon={ICONS.news}
                        color="blue"
                    />
                </div>

                {/* Sidebar Stats - Takes 4/12 columns */}
                <div className="lg:col-span-4 flex flex-col gap-3">
                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex-1">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">System Status</h3>
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 h-[calc(100%-1.5rem)]">
                            <QuickStats label="Server" value="ON" color="emerald" />
                            <QuickStats label="Version" value="1.0" color="blue" />
                            <QuickStats label="Latency" value="24ms" color="emerald" />
                            <QuickStats label="Users" value="-" color="slate" />
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-xl text-white shadow-md relative overflow-hidden group min-h-[100px] flex flex-col justify-center">
                        <div className="relative z-10 pr-8">
                            <h3 className="font-bold text-sm mb-0.5">Mẹo Quản Trị</h3>
                            <p className="text-indigo-100 text-[11px] leading-relaxed">
                                Kiểm tra kỹ chỉ số trước khi cập nhật để tránh lỗi balance.
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
