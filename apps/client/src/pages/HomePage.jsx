import { useState, useEffect } from 'react'
import newsApi from '../services/newsApi'

export default function HomePage() {
    const [news, setNews] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadNews()
    }, [])

    const loadNews = async () => {
        try {
            const response = await newsApi.getNews(10)
            if (response.ok) {
                setNews(response.posts)
            }
        } catch (error) {
            console.error('Failed to load news:', error)
        } finally {
            setLoading(false)
        }
    }

    const formatDate = (dateString) => {
        const date = new Date(dateString)
        return date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long' })
    }

    const getTypeLabel = (type) => {
        const labels = {
            news: 'Tin tức',
            event: 'Sự kiện',
            maintenance: 'Bảo trì',
            update: 'Cập nhật',
        }
        return labels[type] || 'Tin tức'
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="text-center py-8">
                <h1 className="text-3xl font-bold text-blue-900 mb-2 drop-shadow-sm">
                    Chào mừng đến với Thú ảo VNPET
                </h1>
                <p className="text-slate-600 max-w-lg mx-auto">
                    Một thế giới Pokemon trực tuyến nơi bạn có thể bắt, huấn luyện và chiến đấu với hàng ngàn người chơi khác.
                </p>
            </div>

            {loading ? (
                <div className="text-center py-8 text-slate-500">
                    Đang tải tin tức...
                </div>
            ) : news.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                    Chưa có tin tức nào.
                </div>
            ) : (
                news.map((post) => (
                    <div
                        key={post._id}
                        className="border border-blue-200 rounded overflow-hidden shadow-sm bg-white"
                    >
                        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-blue-800 text-lg">{post.title}</h3>
                                <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded">
                                    {getTypeLabel(post.type)}
                                </span>
                            </div>
                            <span className="text-xs text-slate-500 font-medium">
                                {formatDate(post.createdAt)}
                            </span>
                        </div>
                        <div className="p-4 text-slate-700">
                            <p className="whitespace-pre-wrap">{post.content}</p>
                            {post.author && (
                                <p className="mt-4 text-xs text-slate-500">
                                    Đăng bởi: <span className="font-medium">{post.author.username}</span>
                                </p>
                            )}
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}
