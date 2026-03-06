import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import newsApi from '../services/newsApi'

const VIEW_OPTIONS = [
    { key: 'notification', label: 'Thông báo' },
    { key: 'update', label: 'Cập nhật game' },
    { key: 'guide', label: 'Guide game' },
    { key: 'news', label: 'Tin tức game' },
]

export default function HomePage() {
    const [news, setNews] = useState([])
    const [loading, setLoading] = useState(true)
    const [activeView, setActiveView] = useState('notification')
    const navigate = useNavigate()

    useEffect(() => {
        let cancelled = false

        const loadNews = async () => {
            try {
                setLoading(true)

                if (activeView === 'update') {
                    const [updateResponse, maintenanceResponse] = await Promise.all([
                        newsApi.getNews({ limit: 20, type: 'update' }),
                        newsApi.getNews({ limit: 20, type: 'maintenance' }),
                    ])
                    const mergedPosts = [
                        ...(updateResponse?.ok ? (updateResponse.posts || []) : []),
                        ...(maintenanceResponse?.ok ? (maintenanceResponse.posts || []) : []),
                    ]
                    const sortedPosts = mergedPosts
                        .filter((post) => post?.type !== 'event')
                        .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())

                    if (!cancelled) {
                        setNews(sortedPosts)
                    }
                    return
                }

                let posts = []
                if (activeView === 'guide') {
                    const [guideByTypeResponse, guideByTagResponse] = await Promise.all([
                        newsApi.getNews({ limit: 20, type: 'guide' }),
                        newsApi.getNews({ limit: 20, tag: 'guide' }),
                    ])
                    const merged = [
                        ...(guideByTypeResponse?.ok ? (guideByTypeResponse.posts || []) : []),
                        ...(guideByTagResponse?.ok ? (guideByTagResponse.posts || []) : []),
                    ]
                    const seen = new Set()
                    posts = merged.filter((post) => {
                        const id = String(post?._id || '')
                        if (!id || seen.has(id)) return false
                        seen.add(id)
                        return post?.type !== 'event'
                    })
                } else {
                    const response = await newsApi.getNews({ limit: 20, type: activeView })
                    posts = response?.ok
                        ? (response.posts || []).filter((post) => post?.type !== 'event')
                        : []
                }

                if (!cancelled) {
                    setNews(posts)
                }
            } catch (error) {
                console.error('Không thể tải tin tức:', error)
                if (!cancelled) {
                    setNews([])
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        loadNews()

        return () => {
            cancelled = true
        }
    }, [activeView])

    const formatDate = (dateString) => {
        const date = new Date(dateString)
        return date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long' })
    }

    const getTypeLabel = (type) => {
        const labels = {
            news: 'Tin tức game',
            event: 'Sự kiện',
            maintenance: 'Cập nhật game',
            update: 'Cập nhật game',
            notification: 'Thông báo',
            guide: 'Guide game',
        }
        return labels[type] || 'Tin tức game'
    }

    const resolvePostImages = (post) => {
        if (Array.isArray(post?.imageUrls) && post.imageUrls.length > 0) {
            return post.imageUrls
                .map((imageUrl) => String(imageUrl || '').trim())
                .filter(Boolean)
        }

        const legacyImage = String(post?.imageUrl || '').trim()
        return legacyImage ? [legacyImage] : []
    }

    const hasGuideTag = (post) => {
        if (post?.type === 'guide') return true
        if (!Array.isArray(post?.tags)) return false
        return post.tags.some((tag) => String(tag || '').trim().toLowerCase() === 'guide')
    }

    const openPostDetail = (postId) => {
        if (!postId) return
        navigate(`/news/${postId}`)
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

            <div className="rounded border border-blue-200 bg-white p-2 shadow-sm">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {VIEW_OPTIONS.map((option) => {
                        const isActive = option.key === activeView
                        return (
                            <button
                                key={option.key}
                                type="button"
                                onClick={() => setActiveView(option.key)}
                                className={
                                    'px-3 py-2 text-sm font-bold rounded transition-colors ' +
                                    (isActive
                                        ? 'bg-blue-600 text-white shadow'
                                        : 'bg-blue-50 text-blue-800 hover:bg-blue-100')
                                }
                            >
                                {option.label}
                            </button>
                        )
                    })}
                </div>
            </div>

            {loading ? (
                <div className="text-center py-8 text-slate-500">
                    Đang tải tin tức...
                </div>
            ) : news.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                    Chưa có bài viết ở mục này.
                </div>
            ) : (
                news.map((post) => {
                    const postImages = resolvePostImages(post)
                    const isGuidePost = hasGuideTag(post)
                    return (
                        <div
                            key={post._id}
                            className="border border-blue-200 rounded overflow-hidden shadow-sm bg-white cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => openPostDetail(post._id)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    openPostDetail(post._id)
                                }
                            }}
                            role="button"
                            tabIndex={0}
                        >
                            <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex justify-between items-start gap-2">
                                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-0">
                                    <h3 className="font-bold text-blue-800 text-lg break-words">{post.title}</h3>
                                    <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded whitespace-nowrap shrink-0">
                                        {getTypeLabel(post.type)}
                                    </span>
                                    {post.type === 'notification' && (
                                        <span className="text-xs bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0">
                                            Thông báo
                                        </span>
                                    )}
                                    {isGuidePost && (
                                        <span className="text-xs bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0">
                                            Guide
                                        </span>
                                    )}
                                </div>
                                <span className="text-xs text-slate-500 font-medium whitespace-nowrap shrink-0 mt-1">
                                    {formatDate(post.createdAt)}
                                </span>
                            </div>
                            <div className="p-4 text-slate-700">
                                <p className="whitespace-pre-wrap">{post.content}</p>
                                {postImages.length > 0 && (
                                    <div className="mt-3">
                                        <div className="relative overflow-hidden rounded border border-blue-100">
                                            <img
                                                src={postImages[0]}
                                                alt={`${post.title} - 1`}
                                                className="w-full max-h-80 object-cover"
                                            />
                                            {postImages.length > 1 && (
                                                <span className="absolute top-2 right-2 bg-black/65 text-white text-xs font-bold px-2 py-1 rounded">
                                                    +{postImages.length - 1} ảnh
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {post.mapId?.slug && (
                                    <div className="mt-3">
                                        <Link
                                            to={`/map/${post.mapId.slug}`}
                                            onClick={(event) => event.stopPropagation()}
                                            className="inline-flex items-center text-xs font-bold text-blue-700 hover:text-blue-800"
                                        >
                                            Đi đến bản đồ: {post.mapId.name}
                                        </Link>
                                    </div>
                                )}
                                {post.author && (
                                    <p className="mt-4 text-xs text-slate-500">
                                        Đăng bởi: <span className="font-medium">{post.author.username}</span>
                                    </p>
                                )}
                            </div>
                        </div>
                    )
                })
            )}
        </div>
    )
}
