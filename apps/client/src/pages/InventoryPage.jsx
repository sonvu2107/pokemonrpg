import { useEffect, useMemo, useState } from 'react'
import { gameApi } from '../services/gameApi'

// Helper component for section headers with the blue gradient style
const SectionHeader = ({ title }) => (
    <div className="bg-gradient-to-t from-blue-600 to-cyan-400 text-white font-bold px-4 py-1.5 text-center border-y border-blue-700 shadow-sm">
        {title}
    </div>
)

export default function InventoryPage() {
    const [activeTab, setActiveTab] = useState('All Items')
    const [inventory, setInventory] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        const loadInventory = async () => {
            try {
                setLoading(true)
                const data = await gameApi.getInventory()
                setInventory(data.inventory || [])
            } catch (err) {
                setError(err.message)
            } finally {
                setLoading(false)
            }
        }

        loadInventory()
    }, [])

    const items = useMemo(() => {
        return inventory.map((entry) => ({
            id: entry.item?._id || entry._id,
            name: entry.item?.name || 'Unknown Item',
            image: entry.item?.imageUrl || 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png',
            type: entry.item?.type || 'misc',
            quantity: entry.quantity || 0,
        }))
    }, [inventory])

    const filteredItems = useMemo(() => {
        if (activeTab === 'Tất Cả') return items
        if (activeTab === 'Vật Phẩm Chiến Đấu') return items.filter((item) => item.type === 'battle')
        if (activeTab === 'Vật Phẩm Quan Trọng') return items.filter((item) => item.type === 'key')
        if (activeTab === 'Vật Phẩm Khác') return items.filter((item) => !['battle', 'key'].includes(item.type))
        return items
    }, [activeTab, items])

    return (
        <div className="max-w-4xl mx-auto font-sans pb-12">

            {/* Header Title Area */}
            <div className="text-center mb-6">
                <div className="text-slate-600 text-sm font-bold flex justify-center gap-4 mb-2">
                    <span className="flex items-center gap-1">🪙 0 Xu Bạch Kim</span>
                    <span className="flex items-center gap-1 text-purple-700">🌑 0 Điểm Nguyệt Các</span>
                </div>
                <h1 className="text-3xl font-bold text-blue-900 drop-shadow-sm tracking-tight">Túi Đồ Của Bạn</h1>
            </div>

            {/* Inventory Container */}
            <div className="rounded-t-lg overflow-hidden border border-blue-500 shadow-lg bg-slate-800">
                <div className="bg-gradient-to-t from-blue-600 to-cyan-500 text-white font-bold py-1 px-4 text-center border-b border-blue-600">
                    Kho Đồ
                </div>
                <div className="bg-white p-2 sm:p-4 space-y-4">

                    {/* Toggle Item Views */}
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm">
                        <SectionHeader title="Phân Loại Vật Phẩm" />
                        {/* Desktop: Buttons */}
                        <div className="hidden sm:block bg-blue-50/50 p-3 text-center">
                            <div className="flex flex-wrap justify-center gap-2 text-xs font-bold text-blue-700">
                                {['Tất Cả', 'Vật Phẩm Chiến Đấu', 'Vật Phẩm Khác', 'Vật Phẩm Quan Trọng'].map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={`hover:text-amber-600 hover:underline px-2 transition-colors ${activeTab === tab ? 'text-amber-600 underline' : ''}`}
                                    >
                                        [ {tab} ]
                                    </button>
                                ))}
                            </div>
                        </div>
                        {/* Mobile: Dropdown */}
                        <div className="sm:hidden bg-blue-50/50 p-3">
                            <select
                                value={activeTab}
                                onChange={(e) => setActiveTab(e.target.value)}
                                className="w-full px-3 py-2 border border-blue-300 rounded bg-white text-sm font-bold text-blue-700 outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {['Tất Cả', 'Vật Phẩm Chiến Đấu', 'Vật Phẩm Khác', 'Vật Phẩm Quan Trọng'].map((tab) => (
                                    <option key={tab} value={tab}>{tab}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Result / Items Grid */}
                    <div className="border border-blue-400 rounded overflow-hidden shadow-sm min-h-[200px] flex flex-col bg-white">
                        <SectionHeader title="Danh Sách" />
                        <div className="p-1">
                            {/* Mobile: max-height viewport relative, Desktop: fixed height */}
                            <div className="overflow-y-auto custom-scrollbar max-h-[60vh] sm:max-h-[500px] p-3 overscroll-contain touch-pan-y">
                                {error && (
                                    <div className="text-center text-red-500 font-bold py-4">
                                        {error}
                                    </div>
                                )}
                                {loading ? (
                                    <div className="text-center text-slate-500 italic py-8">
                                        Đang tải kho đồ...
                                    </div>
                                ) : (
                                    <>
                                        {/* Mobile: 3 cols, Tablet: 5 cols, Desktop: 8 cols */}
                                        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3 sm:gap-4">
                                            {filteredItems.map(item => (
                                                <div key={item.id} className="flex flex-col items-center justify-center group">
                                                    <div className="w-14 h-14 sm:w-12 sm:h-12 flex items-center justify-center transition-transform group-hover:scale-110">
                                                        <img src={item.image} alt={item.name} className="w-12 h-12 sm:w-10 sm:h-10 pixelated rendering-pixelated" />
                                                    </div>
                                                    <div className="mt-1 text-xs sm:text-[10px] font-bold text-slate-600 group-hover:text-blue-600 text-center leading-tight">
                                                        {item.name}
                                                    </div>
                                                    <div className="text-xs sm:text-[10px] text-slate-500">x{item.quantity}</div>
                                                </div>
                                            ))}
                                        </div>

                                        {filteredItems.length === 0 && (
                                            <div className="text-center text-slate-400 italic py-8">
                                                Túi đồ trống
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    )
}
