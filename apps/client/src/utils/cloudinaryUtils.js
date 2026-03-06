const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

/**
 * Upload image directly to Cloudinary using unsigned upload preset
 * @param {File} file - Image file to upload
 * @param {Function} onProgress - Optional progress callback (percentage)
 * @param {{ folder?: string }} options - Optional upload options
 * @returns {Promise<string>} - Cloudinary image URL
 */
export const uploadToCloudinary = async (file, onProgress, options = {}) => {
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
        throw new Error('Thiếu cấu hình Cloudinary. Vui lòng đặt VITE_CLOUDINARY_CLOUD_NAME và VITE_CLOUDINARY_UPLOAD_PRESET trong .env')
    }

    const folder = String(options?.folder || 'pokemon').trim() || 'pokemon'

    const formData = new FormData()
    formData.append('file', file)
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
    formData.append('folder', folder) // Optional: organize images in folder

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable && onProgress) {
                const percentage = Math.round((e.loaded / e.total) * 100)
                onProgress(percentage)
            }
        })

        xhr.addEventListener('load', () => {
            if (xhr.status === 200) {
                const response = JSON.parse(xhr.responseText)
                resolve(response.secure_url)
            } else {
                try {
                    const error = JSON.parse(xhr.responseText)
                    reject(new Error(`Tải lên thất bại: ${error.error?.message || 'Lỗi không xác định'}`))
                } catch (_err) {
                    reject(new Error(`Tải lên thất bại với mã trạng thái ${xhr.status}`))
                }
            }
        })

        xhr.addEventListener('error', () => {
            reject(new Error('Lỗi mạng khi tải lên'))
        })

        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`)
        xhr.send(formData)
    })
}

export const uploadOneToCloudinary = uploadToCloudinary

export const uploadManyToCloudinary = async (files, { concurrency = 4, onProgress } = {}) => {
    const list = Array.isArray(files) ? files : []
    if (list.length === 0) return []
    const results = new Array(list.length)
    let cursor = 0
    let completed = 0

    const workers = new Array(Math.max(1, concurrency)).fill(0).map(async () => {
        while (true) {
            const idx = cursor
            cursor += 1
            if (idx >= list.length) break
            const url = await uploadToCloudinary(list[idx])
            results[idx] = url
            completed += 1
            if (onProgress) {
                const percentage = Math.round((completed / list.length) * 100)
                onProgress(percentage, { completed, total: list.length })
            }
        }
    })

    await Promise.all(workers)
    return results.filter(Boolean)
}

/**
 * Validate image file before upload
 * @param {File} file
 * @returns {string|null} - Error message or null if valid
 */
export const validateImageFile = (file) => {
    const maxSize = 5 * 1024 * 1024 // 5MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

    if (!file) {
        return 'Chưa chọn tệp'
    }

    if (!allowedTypes.includes(file.type)) {
        return 'Loại tệp không hợp lệ. Vui lòng dùng JPEG, PNG, GIF hoặc WebP'
    }

    if (file.size > maxSize) {
        return 'Tệp quá lớn. Dung lượng tối đa là 5MB'
    }

    return null
}
