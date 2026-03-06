import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import newsApi from '../../services/newsApi'
import ArticleContentRenderer, { hasInlineImageInContent } from '../../components/ArticleContentRenderer'
import ImageUpload from '../../components/ImageUpload'
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
    imageUrl: '',
    imageUrls: [],
    tagsText: '',
})

const createDefaultMapFormData = () => ({
    name: '',
    description: '',
    levelMin: 1,
    levelMax: 10,
    mapImageUrl: '',
})

const normalizeImageUrls = (imageUrls = []) => {
    if (!Array.isArray(imageUrls)) return []
    const normalized = []
    const seen = new Set()

    for (const imageUrl of imageUrls) {
        const nextImageUrl = String(imageUrl || '').trim()
        if (!nextImageUrl || seen.has(nextImageUrl)) continue
        seen.add(nextImageUrl)
        normalized.push(nextImageUrl)
    }

    return normalized
}

const normalizeTags = (tags = []) => {
    if (!Array.isArray(tags)) return []
    const normalized = []
    const seen = new Set()

    for (const tag of tags) {
        const nextTag = String(tag || '').trim().toLowerCase()
        if (!nextTag || seen.has(nextTag)) continue
        seen.add(nextTag)
        normalized.push(nextTag)
    }

    return normalized
}

const parseTagsInput = (value = '') => {
    return normalizeTags(String(value || '').split(','))
}

const resolvePostImages = (post) => {
    const normalized = normalizeImageUrls(post?.imageUrls)
    if (normalized.length > 0) return normalized
    const legacyImage = String(post?.imageUrl || '').trim()
    return legacyImage ? [legacyImage] : []
}

const resolvePostTags = (post) => normalizeTags(post?.tags)

const resolveFilterType = (type) => (type === 'maintenance' ? 'update' : type)

const buildImageMarkdown = (imageUrl, index) => `![anh-${index + 1}](${imageUrl})`

const PAGE_SIZE = 8

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
    const [selectedTypeFilter, setSelectedTypeFilter] = useState('all')
    const [currentPage, setCurrentPage] = useState(1)
    const [showContentPreview, setShowContentPreview] = useState(false)
    const contentTextareaRef = useRef(null)
    const pendingSelectionRef = useRef(null)

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

    useEffect(() => {
        setCurrentPage(1)
    }, [selectedTypeFilter, isEventManager])

    useEffect(() => {
        const pending = pendingSelectionRef.current
        const textarea = contentTextareaRef.current
        if (!pending || !textarea) return

        textarea.focus()
        textarea.setSelectionRange(pending.start, pending.end)
        pendingSelectionRef.current = null
    }, [formData.content])

    const loadPosts = async () => {
        try {
            const response = await newsApi.getAllNews()
            if (response.ok) {
                const allPosts = response.posts || []
                const filteredPosts = isEventManager
                    ? allPosts.filter((post) => post.type === 'event' || post.type === 'update')
                    : allPosts.filter((post) => post.type !== 'event')
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
        const normalizedImageUrls = normalizeImageUrls(formData.imageUrls)
        const { tagsText, ...baseFormData } = formData
        const payload = {
            ...baseFormData,
            title: String(formData.title || '').trim(),
            content: String(formData.content || '').trim(),
            imageUrls: normalizedImageUrls,
            imageUrl: normalizedImageUrls[0] || String(formData.imageUrl || '').trim(),
            tags: parseTagsInput(tagsText),
        }

        try {
            if (editingPost) {
                await newsApi.updateNews(editingPost._id, payload)
            } else {
                await newsApi.createNews(payload)
            }

            setShowForm(false)
            setEditingPost(null)
            setShowContentPreview(false)
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
            imageUrls: resolvePostImages(post),
            imageUrl: String(post.imageUrl || '').trim(),
            tagsText: resolvePostTags(post).join(', '),
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

    const appendUploadedImagesToContent = () => {
        setFormData((prev) => {
            const currentContent = String(prev.content || '')
            const currentTrimmed = currentContent.trimEnd()
            const urls = normalizeImageUrls(prev.imageUrls)
                .filter((url) => !currentContent.includes(url))

            if (urls.length === 0) return prev

            const markdownBlock = urls
                .map((imageUrl, index) => buildImageMarkdown(imageUrl, index))
                .join('\n')

            return {
                ...prev,
                content: currentTrimmed
                    ? `${currentTrimmed}\n\n${markdownBlock}`
                    : markdownBlock,
            }
        })
    }

    const applyEditorContentChange = (updater) => {
        const textarea = contentTextareaRef.current

        setFormData((prev) => {
            const currentContent = String(prev.content || '')
            const selectionStart = textarea ? Number(textarea.selectionStart) : currentContent.length
            const selectionEnd = textarea ? Number(textarea.selectionEnd) : currentContent.length

            const nextState = updater(currentContent, selectionStart, selectionEnd)
            if (!nextState || typeof nextState.nextContent !== 'string') {
                return prev
            }

            const rawStart = Number.isFinite(Number(nextState.selectionStart))
                ? Number(nextState.selectionStart)
                : nextState.nextContent.length
            const rawEnd = Number.isFinite(Number(nextState.selectionEnd))
                ? Number(nextState.selectionEnd)
                : rawStart
            const nextStart = Math.max(0, Math.min(nextState.nextContent.length, rawStart))
            const nextEnd = Math.max(0, Math.min(nextState.nextContent.length, rawEnd))
            pendingSelectionRef.current = { start: nextStart, end: nextEnd }

            return {
                ...prev,
                content: nextState.nextContent,
            }
        })
    }

    const wrapSelectionWithSyntax = (prefix, suffix = '', placeholder = '') => {
        applyEditorContentChange((content, start, end) => {
            const selectedText = content.slice(start, end)
            const hasSelection = start !== end
            const innerText = hasSelection ? selectedText : placeholder
            const insertedText = `${prefix}${innerText}${suffix}`
            const nextContent = `${content.slice(0, start)}${insertedText}${content.slice(end)}`

            if (hasSelection) {
                const caret = start + insertedText.length
                return {
                    nextContent,
                    selectionStart: caret,
                    selectionEnd: caret,
                }
            }

            return {
                nextContent,
                selectionStart: start + prefix.length,
                selectionEnd: start + prefix.length + innerText.length,
            }
        })
    }

    const transformSelectionAsList = () => {
        applyEditorContentChange((content, start, end) => {
            const fallbackText = 'Mục 1\nMục 2'
            const selectedText = start === end ? fallbackText : content.slice(start, end)
            const transformed = selectedText
                .split('\n')
                .map((line) => {
                    const cleaned = String(line || '').trim()
                    if (!cleaned) return ''
                    return `- ${cleaned.replace(/^[-*]\s+/, '')}`
                })
                .join('\n')

            const replaceStart = start
            const replaceEnd = end
            const nextContent = `${content.slice(0, replaceStart)}${transformed}${content.slice(replaceEnd)}`
            const nextCaret = replaceStart + transformed.length

            return {
                nextContent,
                selectionStart: nextCaret,
                selectionEnd: nextCaret,
            }
        })
    }

    const insertHeading = () => {
        applyEditorContentChange((content, start, end) => {
            const selectedText = String(content.slice(start, end) || 'Tiêu đề phụ').trim()
            const headingText = selectedText.replace(/^#{1,6}\s*/, '')
            const insertedText = `## ${headingText}`
            const nextContent = `${content.slice(0, start)}${insertedText}${content.slice(end)}`
            const nextCaret = start + insertedText.length

            return {
                nextContent,
                selectionStart: nextCaret,
                selectionEnd: nextCaret,
            }
        })
    }

    const insertLinkTemplate = () => {
        wrapSelectionWithSyntax('[', '](https://)', 'Link mô tả')
    }

    const insertImageTemplate = () => {
        const firstUploaded = normalizeImageUrls(formData.imageUrls)[0] || 'https://'
        applyEditorContentChange((content, start, end) => {
            const selectedText = String(content.slice(start, end) || 'mo-ta-anh').trim()
            const insertedText = `![${selectedText}](${firstUploaded})`
            const nextContent = `${content.slice(0, start)}${insertedText}${content.slice(end)}`

            const urlStart = start + insertedText.indexOf(firstUploaded)
            const urlEnd = urlStart + firstUploaded.length
            return {
                nextContent,
                selectionStart: urlStart,
                selectionEnd: urlEnd,
            }
        })
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
            news: 'Tin tức game',
            event: 'Sự kiện',
            maintenance: 'Cập nhật game',
            update: 'Cập nhật game',
            notification: 'Thông báo',
            guide: 'Guide game',
        }
        return labels[type] || 'Tin tức game'
    }

    const availableTypes = Array.from(new Set(
        posts.map((post) => resolveFilterType(post.type)).filter(Boolean)
    )).sort((a, b) => getTypeLabel(a).localeCompare(getTypeLabel(b), 'vi'))

    const filteredPosts = posts.filter((post) => {
        if (selectedTypeFilter === 'all') return true
        return resolveFilterType(post.type) === selectedTypeFilter
    })

    const totalPages = Math.max(1, Math.ceil(filteredPosts.length / PAGE_SIZE))
    const safeCurrentPage = Math.min(currentPage, totalPages)
    const startIndex = filteredPosts.length === 0 ? 0 : ((safeCurrentPage - 1) * PAGE_SIZE) + 1
    const endIndex = Math.min(filteredPosts.length, safeCurrentPage * PAGE_SIZE)
    const paginatedPosts = filteredPosts.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE)
    const formPreviewImages = normalizeImageUrls(formData.imageUrls)

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
                            setShowContentPreview(false)
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
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                                    <label className="block text-sm font-bold text-slate-700">
                                        Nội dung
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => setShowContentPreview((prev) => !prev)}
                                        className="px-2 py-1 text-xs font-bold rounded border border-blue-300 text-blue-700 bg-white hover:bg-blue-50"
                                    >
                                        {showContentPreview ? 'Ẩn xem trước' : 'Xem trước bài'}
                                    </button>
                                </div>
                                <div className="mb-2 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={insertHeading}
                                        className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    >
                                        Tiêu đề phụ
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => wrapSelectionWithSyntax('**', '**', 'in đậm')}
                                        className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    >
                                        Đậm
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => wrapSelectionWithSyntax('*', '*', 'in nghiêng')}
                                        className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    >
                                        Nghiêng
                                    </button>
                                    <button
                                        type="button"
                                        onClick={transformSelectionAsList}
                                        className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    >
                                        Danh sách
                                    </button>
                                    <button
                                        type="button"
                                        onClick={insertLinkTemplate}
                                        className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    >
                                        Link
                                    </button>
                                    <button
                                        type="button"
                                        onClick={insertImageTemplate}
                                        className="px-2 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                    >
                                        Ảnh tại con trỏ
                                    </button>
                                </div>
                                <textarea
                                    ref={contentTextareaRef}
                                    value={formData.content}
                                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                    rows="9"
                                    className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                                <p className="mt-1 text-[11px] text-slate-500">
                                    Hỗ trợ markdown cơ bản: # ## ###, - danh sách, **đậm**, *nghiêng*, [link](https://...), ![mô tả](url ảnh).
                                </p>
                                {showContentPreview && (
                                    <div className="mt-3 rounded border border-blue-200 bg-white p-3">
                                        <div className="text-xs font-bold text-blue-700 mb-2">Xem trước nội dung</div>
                                        {String(formData.content || '').trim() ? (
                                            <>
                                                <ArticleContentRenderer content={formData.content} title={formData.title || 'Bài viết'} />
                                                {!hasInlineImageInContent(formData.content) && formPreviewImages.length > 0 && (
                                                    <div className="mt-3">
                                                        <div className="relative overflow-hidden rounded border border-blue-100">
                                                            <img
                                                                src={formPreviewImages[0]}
                                                                alt="Preview"
                                                                className="w-full max-h-72 object-cover"
                                                            />
                                                            {formPreviewImages.length > 1 && (
                                                                <span className="absolute top-2 right-2 bg-black/65 text-white text-xs font-bold px-2 py-1 rounded">
                                                                    +{formPreviewImages.length - 1} ảnh
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <div className="text-xs text-slate-500">Chưa có nội dung để xem trước.</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">
                                    Tags (phân cách bằng dấu phẩy)
                                </label>
                                <input
                                    type="text"
                                    value={formData.tagsText}
                                    onChange={(e) => setFormData({ ...formData, tagsText: e.target.value })}
                                    placeholder="vd: quan-trong, vip, su-kien"
                                    className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div className="rounded border border-blue-200 bg-white p-3">
                                <ImageUpload
                                    currentImage={formData.imageUrls[0] || formData.imageUrl}
                                    multiple
                                    previewFramed
                                    onUploadSuccess={(urls) => {
                                        const normalizedUrls = normalizeImageUrls(urls)
                                        setFormData((prev) => ({
                                            ...prev,
                                            imageUrls: normalizedUrls,
                                            imageUrl: normalizedUrls[0] || '',
                                        }))
                                    }}
                                    label="Ảnh tin tức (nhiều ảnh)"
                                />
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={appendUploadedImagesToContent}
                                        disabled={formPreviewImages.length === 0}
                                        className="px-2 py-1 text-xs font-bold rounded border border-blue-300 text-blue-700 bg-white hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Chèn ảnh vào nội dung
                                    </button>
                                    <span className="text-[11px] text-slate-500">
                                        Dùng cú pháp: ![mô tả](url) để chèn ảnh ngay giữa bài.
                                    </span>
                                </div>
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
                                        {!isEventManager && <option value="notification">Thông báo</option>}
                                        {!isEventManager && <option value="update">Cập nhật game</option>}
                                        {!isEventManager && <option value="guide">Guide game</option>}
                                        {!isEventManager && <option value="news">Tin tức game</option>}
                                        {isEventManager && <option value="event">Sự kiện</option>}
                                        {isEventManager && <option value="update">Cập nhật game</option>}
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
                                        setShowContentPreview(false)
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
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-blue-100 bg-blue-50 px-3 py-2">
                        <div className="text-xs font-medium text-blue-800">
                            Hiển thị {startIndex}-{endIndex} / {filteredPosts.length} bài
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-slate-700">Lọc theo loại</label>
                            <select
                                value={selectedTypeFilter}
                                onChange={(e) => setSelectedTypeFilter(e.target.value)}
                                className="px-2 py-1 text-xs border border-blue-200 rounded bg-white text-slate-700"
                            >
                                <option value="all">Tất cả</option>
                                {availableTypes.map((type) => (
                                    <option key={type} value={type}>{getTypeLabel(type)}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {loading ? (
                        <div className="text-center py-8 text-slate-500">Đang tải...</div>
                    ) : filteredPosts.length === 0 ? (
                        <div className="text-center py-8 text-slate-500">
                            {selectedTypeFilter === 'all'
                                ? (isEventManager ? 'Chưa có sự kiện/cập nhật nào.' : 'Chưa có tin tức nào.')
                                : 'Không có bài viết nào khớp loại đã chọn.'}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {paginatedPosts.map((post) => {
                                const postImages = resolvePostImages(post)
                                const postTags = resolvePostTags(post)
                                return (
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
                                                {post.type === 'notification' && (
                                                    <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded border border-amber-200">
                                                        Thông báo
                                                    </span>
                                                )}
                                                {!post.isPublished && (
                                                    <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded">
                                                        Nháp
                                                    </span>
                                                )}
                                                {postTags.map((tag) => (
                                                    <span
                                                        key={`${post._id}-${tag}`}
                                                        className="text-[10px] bg-white text-slate-700 px-2 py-0.5 rounded border border-slate-300"
                                                    >
                                                        #{tag}
                                                    </span>
                                                ))}
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
                                            {postImages.length > 0 && (
                                                <div className="mb-3 mt-2">
                                                    <div className="relative overflow-hidden rounded border border-blue-100">
                                                        <img
                                                            src={postImages[0]}
                                                            alt={`${post.title} - 1`}
                                                            className="w-full h-36 object-cover"
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
                                )
                            })}
                        </div>
                    )}

                    {!loading && filteredPosts.length > 0 && (
                        <div className="mt-4 flex items-center justify-center gap-2">
                            <button
                                type="button"
                                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                                disabled={safeCurrentPage <= 1}
                                className="px-3 py-1 text-xs font-bold rounded border border-blue-300 text-blue-700 bg-white hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                ← Trước
                            </button>
                            <span className="text-xs font-bold text-slate-700 px-2">
                                Trang {safeCurrentPage}/{totalPages}
                            </span>
                            <button
                                type="button"
                                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                                disabled={safeCurrentPage >= totalPages}
                                className="px-3 py-1 text-xs font-bold rounded border border-blue-300 text-blue-700 bg-white hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Sau →
                            </button>
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
