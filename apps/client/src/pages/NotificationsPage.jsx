import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import SmartImage from '../components/SmartImage'
import newsApi from '../services/newsApi'

const FALLBACK_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png'

const resolvePostImages = (post) => {
    if (Array.isArray(post?.imageUrls) && post.imageUrls.length > 0) {
        return post.imageUrls
            .map((imageUrl) => String(imageUrl || '').trim())
            .filter(Boolean)
    }

    const legacyImage = String(post?.imageUrl || '').trim()
    return legacyImage ? [legacyImage] : []
}

const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('vi-VN', { day: 'numeric', month: 'long' })
}

export default function NotificationsPage() {
    const [posts, setPosts] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const navigate = useNavigate()

    useEffect(() => {
        let cancelled = false

        const loadPosts = async () => {
            try {
                setLoading(true)
                setError('')
                const response = await newsApi.getNews({ limit: 50, type: 'notification' })
                if (cancelled) return
                setPosts(Array.isArray(response?.posts) ? response.posts : [])
            } catch (err) {
                if (cancelled) return
                setPosts([])
                setError(String(err?.message || 'Không thể tải thông báo'))
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        loadPosts()

        return () => {
            cancelled = true
        }
    }, [])

    const summaryText = useMemo(() => {
        if (loading) return 'Đang tải thông báo...'
        if (posts.length === 0) return 'Hiện chưa có thông báo mới.'
        return `Hiện có ${posts.length} thông báo đang hiển thị.`
    }, [loading, posts.length])

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="text-center py-8">
                <h1 className="text-3xl font-bold text-blue-900 mb-2 drop-shadow-sm">Thông Báo</h1>
                <p className="text-slate-600 max-w-2xl mx-auto">{summaryText}</p>
            </div>

            {error && (
                <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="rounded border border-blue-200 bg-white py-12 text-center text-slate-500 shadow-sm">
                    Đang tải thông báo...
                </div>
            ) : posts.length === 0 ? (
                <div className="rounded border-2 border-dashed border-blue-200 bg-white py-12 text-center text-slate-500 shadow-sm">
                    Chưa có thông báo phù hợp.
                </div>
            ) : (
                <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 md:gap-6">
                    {posts.map((post) => {
                        const images = resolvePostImages(post)
                        const imageUrl = images[0] || FALLBACK_IMAGE

                        return (
                            <article
                                key={post._id}
                                className="overflow-hidden rounded-lg border-2 border-blue-600 bg-white shadow-[0_6px_18px_rgba(30,64,175,0.14)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(30,64,175,0.2)] sm:rounded-xl sm:shadow-[0_8px_24px_rgba(30,64,175,0.16)]"
                            >
                                <div
                                    className="relative aspect-[16/9] cursor-pointer overflow-hidden border-b-2 border-blue-600 bg-gradient-to-br from-cyan-100 via-blue-100 to-indigo-100 sm:aspect-[18/9]"
                                    onClick={() => navigate(`/news/${post._id}`)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault()
                                            navigate(`/news/${post._id}`)
                                        }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                >
                                    <SmartImage
                                        src={imageUrl}
                                        alt={post?.title || 'Thông báo'}
                                        width={960}
                                        height={540}
                                        className="h-full w-full object-cover"
                                        fallback={FALLBACK_IMAGE}
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 via-transparent to-transparent" />
                                    <div className="absolute left-2 top-2 rounded border border-white/80 bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white shadow sm:left-3 sm:top-3 sm:border-2 sm:px-2 sm:py-1 sm:text-[11px] sm:tracking-[0.2em]">
                                        Thông báo
                                    </div>
                                </div>
                                <div className="bg-white px-3 py-2.5 text-center sm:px-4 sm:py-3">
                                    <Link to={`/news/${post._id}`} className="text-sm font-extrabold uppercase tracking-wide text-blue-900 hover:text-blue-700 sm:text-base">
                                        {post?.title}
                                    </Link>
                                    <div className="mt-1 text-xs font-semibold text-slate-500">{formatDate(post?.createdAt)}</div>
                                </div>
                            </article>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
