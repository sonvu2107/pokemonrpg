import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import SmartImage from '../components/SmartImage'
import newsApi from '../services/newsApi'

const FALLBACK_EVENT_IMAGE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/151.png'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

const resolvePostImages = (post) => {
    if (Array.isArray(post?.imageUrls) && post.imageUrls.length > 0) {
        return post.imageUrls
            .map((imageUrl) => String(imageUrl || '').trim())
            .filter(Boolean)
    }

    const legacyImage = String(post?.imageUrl || '').trim()
    return legacyImage ? [legacyImage] : []
}

const sortPostsByDate = (posts = []) => {
    return [...posts].sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())
}

export default function EventMapsPage() {
    const [eventPosts, setEventPosts] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        let cancelled = false

        const loadEventMaps = async () => {
            try {
                setLoading(true)
                setError('')
                const [mapsResponse, eventResponse] = await Promise.all([
                    fetch(`${API_URL}/maps`),
                    newsApi.getNews({ limit: 50, type: 'event' }),
                ])

                if (!mapsResponse.ok) {
                    throw new Error('Không thể tải khu vực sự kiện')
                }
                const mapsData = await mapsResponse.json()
                if (cancelled) return

                const mapImageById = new Map(
                    (Array.isArray(mapsData?.maps) ? mapsData.maps : []).map((map) => [
                        String(map?._id || '').trim(),
                        String(map?.mapImageUrl || '').trim(),
                    ])
                )

                const posts = sortPostsByDate(Array.isArray(eventResponse?.posts) ? eventResponse.posts : [])
                    .map((post) => ({
                        ...post,
                        resolvedMapImageUrl: mapImageById.get(String(post?.mapId?._id || '').trim()) || '',
                    }))

                setEventPosts(posts)
            } catch (err) {
                if (cancelled) return
                setEventPosts([])
                setError(String(err?.message || 'Không thể tải khu vực sự kiện'))
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        }

        loadEventMaps()

        return () => {
            cancelled = true
        }
    }, [])

    const summaryText = useMemo(() => {
        if (loading) return 'Đang tải khu vực sự kiện...'
        if (eventPosts.length === 0) return 'Hiện chưa có khu vực sự kiện nào đang mở.'
        return `Hiện có ${eventPosts.length} khu vực sự kiện đang hiển thị.`
    }, [loading, eventPosts.length])

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="text-center py-8">
                <h1 className="text-3xl font-bold text-blue-900 mb-2 drop-shadow-sm">Khu Vực Sự Kiện</h1>
                <p className="text-slate-600 max-w-2xl mx-auto">{summaryText}</p>
            </div>

            {error && (
                <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="rounded border border-blue-200 bg-white py-12 text-center text-slate-500 shadow-sm">
                    Đang tải bản đồ sự kiện...
                </div>
            ) : eventPosts.length === 0 ? (
                <div className="rounded border-2 border-dashed border-blue-200 bg-white py-12 text-center text-slate-500 shadow-sm">
                    Chưa có bản đồ sự kiện phù hợp.
                </div>
            ) : (
                <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 md:gap-6">
                    {eventPosts.map((post) => {
                        const target = post?.mapId?.slug ? `/map/${post.mapId.slug}` : (post?._id ? `/news/${post._id}` : '#')
                        const displayName = String(post?.mapId?.name || post?.title || 'Khu vực sự kiện').trim()
                        const postImages = resolvePostImages(post)
                        const imageUrl = String(post?.resolvedMapImageUrl || '').trim() || postImages[0] || FALLBACK_EVENT_IMAGE

                        return (
                            <Link
                                key={post._id}
                                to={target}
                                className="overflow-hidden rounded-lg border-2 border-blue-600 bg-white shadow-[0_6px_18px_rgba(30,64,175,0.14)] transition duration-200 hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(30,64,175,0.2)] sm:rounded-xl sm:shadow-[0_8px_24px_rgba(30,64,175,0.16)]"
                            >
                                <div className="relative aspect-[16/9] overflow-hidden border-b-2 border-blue-600 bg-gradient-to-br from-cyan-100 via-blue-100 to-indigo-100 sm:aspect-[18/9]">
                                    <SmartImage
                                        src={imageUrl}
                                        alt={displayName}
                                        width={640}
                                        height={640}
                                        className="h-full w-full object-cover"
                                        fallback={FALLBACK_EVENT_IMAGE}
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/45 via-transparent to-transparent" />
                                    <div className="absolute left-2 top-2 rounded border border-white/80 bg-rose-500 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-white shadow sm:left-3 sm:top-3 sm:border-2 sm:px-2 sm:py-1 sm:text-[11px] sm:tracking-[0.2em]">
                                        Event
                                    </div>
                                </div>
                                <div className="bg-white px-3 py-2.5 text-center sm:px-4 sm:py-3">
                                    <div className="text-sm font-extrabold uppercase tracking-wide text-blue-900 sm:text-base">{displayName}</div>
                                </div>
                            </Link>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
