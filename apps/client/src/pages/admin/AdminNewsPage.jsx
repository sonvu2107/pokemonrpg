import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import newsApi from '../../services/newsApi'
import { mapApi as publicMapApi } from '../../services/mapApi'
import { mapApi as adminMapApi } from '../../services/adminApi'
import { useAuth } from '../../context/AuthContext'
import { ADMIN_PERMISSIONS } from '../../constants/adminPermissions'

const createDefaultFormData = (isEventManager) => ({
    title: '',
    content: '',
    type: isEventManager ? 'event' : 'news',
    isPublished: true,
    mapId: '',
})

const createDefaultMapFormData = () => ({
    name: '',
    description: '',
    levelMin: 1,
    levelMax: 10,
    mapImageUrl: '',
})

export default function AdminNewsPage({ mode = 'all' }) {
    const { canAccessAdminModule } = useAuth()
    const [posts, setPosts] = useState([])
    const [maps, setMaps] = useState([])
    const [loadingMaps, setLoadingMaps] = useState(false)
    const [showMapCreator, setShowMapCreator] = useState(false)
    const [creatingMap, setCreatingMap] = useState(false)
    const [mapCreateError, setMapCreateError] = useState('')
    const [mapCreateSuccess, setMapCreateSuccess] = useState('')
    const [newMapData, setNewMapData] = useState(createDefaultMapFormData())
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [editingPost, setEditingPost] = useState(null)
    const [formData, setFormData] = useState(createDefaultFormData(mode === 'events'))

    const isEventManager = mode === 'events'
    const canManageMaps = canAccessAdminModule(ADMIN_PERMISSIONS.MAPS)

    useEffect(() => {
        loadPosts()
    }, [isEventManager])

    useEffect(() => {
        if (!isEventManager) return
        loadMaps()
    }, [isEventManager])

    useEffect(() => {
        if (!isEventManager) {
            setShowMapCreator(false)
            setMapCreateError('')
            setMapCreateSuccess('')
        }
    }, [isEventManager])

    const loadPosts = async () => {
        try {
            const response = await newsApi.getAllNews()
            if (response.ok) {
                const allPosts = response.posts || []
                const filteredPosts = isEventManager
                    ? allPosts.filter((post) => post.type === 'event' || post.type === 'update')
                    : allPosts
                setPosts(filteredPosts)
            }
        } catch (error) {
            console.error('Không thể tải bài viết:', error)
        } finally {
            setLoading(false)
        }
    }

    const loadMaps = async () => {
        try {
            setLoadingMaps(true)
            const allMaps = await publicMapApi.list()
            setMaps(allMaps)
        } catch (error) {
            console.error('Không thể tải danh sách bản đồ:', error)
            setMaps([])
        } finally {
            setLoadingMaps(false)
        }
    }

    const handleCreateMap = async () => {
        const parsedLevelMin = Math.max(1, parseInt(newMapData.levelMin, 10) || 1)
        const parsedLevelMax = Math.max(1, parseInt(newMapData.levelMax, 10) || 1)
        const trimmedName = String(newMapData.name || '').trim()

        if (!trimmedName) {
            setMapCreateError('Vui lòng nhập tên bản đồ')
            return
        }

        if (parsedLevelMax < parsedLevelMin) {
            setMapCreateError('Cấp độ tối đa phải >= cấp độ tối thiểu')
            return
        }

        try {
            setCreatingMap(true)
            setMapCreateError('')
            setMapCreateSuccess('')

            const response = await adminMapApi.create({
                name: trimmedName,
                description: String(newMapData.description || '').trim(),
                mapImageUrl: String(newMapData.mapImageUrl || '').trim(),
                levelMin: parsedLevelMin,
                levelMax: parsedLevelMax,
                requiredSearches: 0,
                encounterRate: 1,
                itemDropRate: 0,
                orderIndex: 0,
            })

            const createdMap = response?.map || null
            await loadMaps()

            if (createdMap?._id) {
                setFormData((prev) => ({
                    ...prev,
                    mapId: createdMap._id,
                }))
            }

            setMapCreateSuccess(`Đã tạo map mới: ${createdMap?.name || trimmedName}`)
            setNewMapData(createDefaultMapFormData())
            setShowMapCreator(false)
        } catch (error) {
            console.error('Không thể tạo bản đồ mới:', error)
            setMapCreateError(error.message || 'Tạo bản đồ thất bại')
        } finally {
            setCreatingMap(false)
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault()

        try {
            if (editingPost) {
                await newsApi.updateNews(editingPost._id, formData)
            } else {
                await newsApi.createNews(formData)
            }

            setShowForm(false)
            setEditingPost(null)
            setFormData(createDefaultFormData(isEventManager))
            loadPosts()
        } catch (error) {
            console.error('Không thể lưu bài viết:', error)
            alert('Có lỗi xảy ra khi lưu bài viết')
        }
    }

    const handleEdit = (post) => {
        setEditingPost(post)
        setFormData({
            title: post.title,
            content: post.content,
            type: post.type,
            isPublished: post.isPublished,
            mapId: post.mapId?._id || '',
        })
        setShowForm(true)
    }

    const handleDelete = async (id) => {
        if (!confirm('Bạn có chắc muốn xóa bài viết này?')) return

        try {
            await newsApi.deleteNews(id)
            loadPosts()
        } catch (error) {
            console.error('Không thể xóa bài viết:', error)
            alert('Có lỗi xảy ra khi xóa bài viết')
        }
    }

    const formatDate = (dateString) => {
        const date = new Date(dateString)
        return date.toLocaleDateString('vi-VN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        })
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
        <div className="space-y-4">
            <div className="rounded border border-blue-400 bg-white shadow-sm">
                <div className="border-b border-blue-400 bg-gradient-to-t from-blue-600 to-cyan-500 px-3 py-2 flex justify-between items-center">
                    <h1 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm">
                        {isEventManager ? 'Quản Lý Sự Kiện & Cập Nhật' : 'Quản Lý Tin Tức'}
                    </h1>
                    <button
                        onClick={() => {
                            setShowForm(!showForm)
                            setEditingPost(null)
                            setFormData(createDefaultFormData(isEventManager))
                        }}
                        className="px-3 py-1 bg-white hover:bg-blue-50 text-blue-700 rounded text-sm font-bold shadow-sm transition-colors"
                    >
                        {showForm ? 'Hủy' : (isEventManager ? '+ Thêm Sự Kiện/Cập Nhật' : '+ Thêm Tin Tức')}
                    </button>
                </div>

                {showForm && (
                    <div className="p-4 bg-blue-50 border-b border-blue-200">
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">
                                    Tiêu đề
                                </label>
                                <input
                                    type="text"
                                    value={formData.title}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">
                                    Nội dung
                                </label>
                                <textarea
                                    value={formData.content}
                                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                    rows="6"
                                    className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">
                                        Loại
                                    </label>
                                    <select
                                        value={formData.type}
                                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                        className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        {!isEventManager && <option value="news">Tin tức</option>}
                                        <option value="event">Sự kiện</option>
                                        {!isEventManager && <option value="maintenance">Bảo trì</option>}
                                        <option value="update">Cập nhật</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">
                                        Trạng thái
                                    </label>
                                    <select
                                        value={formData.isPublished}
                                        onChange={(e) =>
                                            setFormData({ ...formData, isPublished: e.target.value === 'true' })
                                        }
                                        className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="true">Công khai</option>
                                        <option value="false">Nháp</option>
                                    </select>
                                </div>
                            </div>

                            {isEventManager && (
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 mb-1">
                                        Bản đồ sự kiện (tuỳ chọn)
                                    </label>
                                    <select
                                        value={formData.mapId}
                                        onChange={(e) => setFormData({ ...formData, mapId: e.target.value })}
                                        className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">-- Không liên kết bản đồ --</option>
                                        {maps.map((map) => (
                                            <option key={map._id} value={map._id}>
                                                {map.name}
                                            </option>
                                        ))}
                                    </select>
                                    {loadingMaps && (
                                        <p className="text-xs text-slate-500 mt-1">Đang tải danh sách bản đồ...</p>
                                    )}

                                    {canManageMaps ? (
                                        <div className="mt-2 space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setShowMapCreator((prev) => !prev)
                                                        setMapCreateError('')
                                                        setMapCreateSuccess('')
                                                    }}
                                                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold"
                                                >
                                                    {showMapCreator ? 'Đóng tạo map nhanh' : '+ Tạo map mới nhanh'}
                                                </button>
                                                <Link
                                                    to="/admin/maps/create"
                                                    className="px-3 py-1 bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 rounded text-xs font-bold"
                                                >
                                                    Mở form map đầy đủ
                                                </Link>
                                            </div>

                                            {mapCreateSuccess && (
                                                <p className="text-xs text-emerald-700 font-bold">{mapCreateSuccess}</p>
                                            )}
                                            {mapCreateError && (
                                                <p className="text-xs text-red-600 font-bold">{mapCreateError}</p>
                                            )}

                                            {showMapCreator && (
                                                <div className="p-3 border border-emerald-200 rounded bg-emerald-50 space-y-2">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                        <input
                                                            type="text"
                                                            value={newMapData.name}
                                                            onChange={(e) => setNewMapData({ ...newMapData, name: e.target.value })}
                                                            placeholder="Tên bản đồ mới"
                                                            className="w-full px-3 py-2 border border-emerald-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                        />
                                                        <input
                                                            type="text"
                                                            value={newMapData.mapImageUrl}
                                                            onChange={(e) => setNewMapData({ ...newMapData, mapImageUrl: e.target.value })}
                                                            placeholder="URL ảnh map (tuỳ chọn)"
                                                            className="w-full px-3 py-2 border border-emerald-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={newMapData.levelMin}
                                                            onChange={(e) => setNewMapData({ ...newMapData, levelMin: e.target.value })}
                                                            className="w-full px-3 py-2 border border-emerald-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                            placeholder="Level min"
                                                        />
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={newMapData.levelMax}
                                                            onChange={(e) => setNewMapData({ ...newMapData, levelMax: e.target.value })}
                                                            className="w-full px-3 py-2 border border-emerald-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                            placeholder="Level max"
                                                        />
                                                    </div>
                                                    <textarea
                                                        value={newMapData.description}
                                                        onChange={(e) => setNewMapData({ ...newMapData, description: e.target.value })}
                                                        rows="2"
                                                        placeholder="Mô tả map (tuỳ chọn)"
                                                        className="w-full px-3 py-2 border border-emerald-300 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                                    />
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={creatingMap}
                                                            onClick={handleCreateMap}
                                                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold disabled:opacity-60"
                                                        >
                                                            {creatingMap ? 'Đang tạo...' : 'Tạo map'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setShowMapCreator(false)
                                                                setNewMapData(createDefaultMapFormData())
                                                                setMapCreateError('')
                                                            }}
                                                            className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-xs font-bold"
                                                        >
                                                            Hủy
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-500 mt-2">
                                            Bạn cần quyền quản lý bản đồ để tạo map mới trực tiếp tại đây.
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="flex gap-2">
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold shadow-sm transition-colors"
                                >
                                    {editingPost ? 'Cập nhật' : 'Đăng'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowForm(false)
                                        setEditingPost(null)
                                        setFormData(createDefaultFormData(isEventManager))
                                    }}
                                    className="px-4 py-2 bg-slate-400 hover:bg-slate-500 text-white rounded font-bold shadow-sm transition-colors"
                                >
                                    Hủy
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                <div className="p-4">
                    {loading ? (
                        <div className="text-center py-8 text-slate-500">Đang tải...</div>
                    ) : posts.length === 0 ? (
                        <div className="text-center py-8 text-slate-500">
                            {isEventManager ? 'Chưa có sự kiện/cập nhật nào.' : 'Chưa có tin tức nào.'}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {posts.map((post) => (
                                <div
                                    key={post._id}
                                    className="border border-blue-200 rounded bg-white shadow-sm overflow-hidden"
                                >
                                    <div className="bg-blue-50 border-b border-blue-100 px-3 py-2 flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-bold text-blue-800">{post.title}</h3>
                                            <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded">
                                                {getTypeLabel(post.type)}
                                            </span>
                                            {!post.isPublished && (
                                                <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded">
                                                    Nháp
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleEdit(post)}
                                                className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-bold"
                                            >
                                                Sửa
                                            </button>
                                            <button
                                                onClick={() => handleDelete(post._id)}
                                                className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-bold"
                                            >
                                                Xóa
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-3">
                                        <p className="text-sm text-slate-700 mb-2 line-clamp-2">{post.content}</p>
                                        {post.mapId?.slug && (
                                            <Link
                                                to={`/map/${post.mapId.slug}`}
                                                className="inline-flex items-center text-xs text-blue-700 hover:text-blue-800 font-bold mb-2"
                                            >
                                                Map: {post.mapId.name}
                                            </Link>
                                        )}
                                        <div className="flex justify-between items-center text-xs text-slate-500">
                                            <span>Đăng bởi: {post.author?.username || 'Unknown'}</span>
                                            <span>{formatDate(post.createdAt)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="text-center">
                <Link
                    to="/admin"
                    className="inline-block px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded font-bold shadow-sm"
                >
                    ← Quay lại Dashboard
                </Link>
            </div>
        </div>
    )
}
