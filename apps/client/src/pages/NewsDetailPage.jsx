import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import newsApi from '../services/newsApi'

const getTypeLabel = (type) => {
    const labels = {
        news: 'Tin tức',
        event: 'Sự kiện',
        maintenance: 'Bảo trì',
        update: 'Cập nhật',
    }
    return labels[type] || 'Tin tức'
}

const formatDateTime = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('vi-VN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

export default function NewsDetailPage() {
    const { id } = useParams()
    const [post, setPost] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false

        const loadPost = async () => {
            try {
                setLoading(true)
                setError('')
                const response = await newsApi.getNewsById(id)
                if (!cancelled && response?.ok) {
                    setPost(response.post || null)
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err?.message || 'Không thể tải chi tiết tin tức')
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        loadPost()

        return () => {
            cancelled = true
        }
    }, [id])

    return (
        <div className="space-y-4 animate-fadeIn">
            <div>
                <Link
                    to="/"
                    className="inline-flex items-center text-sm font-bold text-blue-700 hover:text-blue-800"
                >
                    ← Quay lại trang chủ
                </Link>
            </div>

            {loading ? (
                <div className="text-center py-8 text-slate-500">Đang tải chi tiết tin tức...</div>
            ) : error ? (
                <div className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
                    {error}
                </div>
            ) : !post ? (
                <div className="rounded border border-slate-200 bg-white p-4 text-slate-500">
                    Không tìm thấy bài viết.
                </div>
            ) : (
                <article className="border border-blue-200 rounded overflow-hidden shadow-sm bg-white">
                    <header className="bg-blue-50 border-b border-blue-100 px-4 py-3 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-xl font-bold text-blue-900 break-words">{post.title}</h1>
                            <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded">
                                {getTypeLabel(post.type)}
                            </span>
                        </div>
                        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>{formatDateTime(post.createdAt)}</span>
                            <span>Đăng bởi: {post.author?.username || 'Unknown'}</span>
                        </div>
                    </header>

                    <div className="p-4 text-slate-700">
                        <p className="whitespace-pre-wrap">{post.content}</p>
                        {post.mapId?.slug && (
                            <div className="mt-4">
                                <Link
                                    to={`/map/${post.mapId.slug}`}
                                    className="inline-flex items-center text-sm font-bold text-blue-700 hover:text-blue-800"
                                >
                                    Đi đến bản đồ: {post.mapId.name}
                                </Link>
                            </div>
                        )}
                    </div>
                </article>
            )}
        </div>
    )
}
