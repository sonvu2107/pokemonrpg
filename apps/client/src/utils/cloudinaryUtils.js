const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

/**
 * Upload image directly to Cloudinary using unsigned upload preset
 * @param {File} file - Image file to upload
 * @param {Function} onProgress - Optional progress callback (percentage)
 * @returns {Promise<string>} - Cloudinary image URL
 */
export const uploadToCloudinary = async (file, onProgress) => {
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
        throw new Error('Cloudinary configuration missing. Please set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in .env')
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
    formData.append('folder', 'pokemon') // Optional: organize images in folder

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
                    reject(new Error(`Upload failed: ${error.error?.message || 'Unknown error'}`))
                } catch {
                    reject(new Error(`Upload failed with status ${xhr.status}`))
                }
            }
        })

        xhr.addEventListener('error', () => {
            reject(new Error('Network error during upload'))
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
        return 'No file selected'
    }

    if (!allowedTypes.includes(file.type)) {
        return 'Invalid file type. Please use JPEG, PNG, GIF, or WebP'
    }

    if (file.size > maxSize) {
        return 'File too large. Maximum size is 5MB'
    }

    return null
}
