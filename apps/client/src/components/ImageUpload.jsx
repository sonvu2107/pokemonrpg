import { useId, useState } from 'react'
import { uploadToCloudinary, uploadManyToCloudinary, validateImageFile } from '../utils/cloudinaryUtils'

export default function ImageUpload({
    currentImage,
    onUploadSuccess,
    onFilesSelected,
    multiple = false,
    label = 'Upload Image',
}) {
    const [uploading, setUploading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState('')
    const [preview, setPreview] = useState(currentImage || '')
    const inputId = useId()

    const validateFiles = (files) => {
        for (const file of files) {
            const validationError = validateImageFile(file)
            if (validationError) return validationError
        }
        return null
    }

    const setPreviewFromFile = (file) => {
        if (!file) return
        const reader = new FileReader()
        reader.onloadend = () => {
            setPreview(reader.result)
        }
        reader.readAsDataURL(file)
    }

    const handleFileSelect = async (files) => {
        setError('')
        const list = Array.isArray(files) ? files : [files].filter(Boolean)
        if (list.length === 0) return

        // Validate
        const validationError = validateFiles(list)
        if (validationError) {
            setError(validationError)
            return
        }

        // Preview
        setPreviewFromFile(list[0])

        if (onFilesSelected) {
            onFilesSelected(list)
            return
        }

        // Upload
        try {
            setUploading(true)
            setProgress(0)

            if (multiple) {
                const urls = await uploadManyToCloudinary(list, {
                    onProgress: (percentage) => setProgress(percentage),
                })
                onUploadSuccess?.(urls)
                if (urls[0]) setPreview(urls[0])
            } else {
                const url = await uploadToCloudinary(list[0], (percentage) => {
                    setProgress(percentage)
                })

                onUploadSuccess?.(url)
                setPreview(url)
            }
        } catch (err) {
            setError(err.message || 'Upload failed')
            setPreview(currentImage || '')
        } finally {
            setUploading(false)
            setProgress(0)
        }
    }

    const handleDrop = (e) => {
        e.preventDefault()
        const files = Array.from(e.dataTransfer.files || [])
        if (files.length > 0) handleFileSelect(multiple ? files : files[0])
    }

    const handleDragOver = (e) => {
        e.preventDefault()
    }

    const handleClear = () => {
        if (confirm('Xóa ảnh này? Bạn có thể upload ảnh mới sau.')) {
            setPreview('')
            setError('')
            if (onUploadSuccess) {
                onUploadSuccess(multiple ? [] : '')
            }
        }
    }

    return (
        <div>
            <label className="block text-slate-700 text-xs font-bold mb-2 uppercase">{label}</label>

            <div className="flex items-start gap-4">
                {/* Preview Section */}
                <div className="relative shrink-0 group">
                    {preview ? (
                        <>
                            <img
                                src={preview}
                                alt="Preview"
                                className="w-24 h-24 object-contain bg-slate-100 rounded-lg border border-slate-200 shadow-sm"
                            />
                            <button
                                type="button"
                                onClick={handleClear}
                                className="absolute -top-2 -right-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-full p-1 shadow-sm transition-colors opacity-0 group-hover:opacity-100"
                                title="Xóa ảnh"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                </svg>
                            </button>
                        </>
                    ) : (
                        <div className="w-24 h-24 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center text-slate-300">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                    )}
                </div>

                {/* Upload Section */}
                <div className="flex-1">
                    <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        className="border border-dashed border-blue-300 rounded-lg p-3 text-center bg-blue-50/50 hover:bg-blue-50 transition-colors cursor-pointer h-24 flex flex-col items-center justify-center group"
                    >
                        <input
                            type="file"
                            accept="image/*"
                            multiple={multiple}
                            onChange={(e) => {
                                const files = Array.from(e.target.files || [])
                                if (files.length > 0) handleFileSelect(multiple ? files : files[0])
                            }}
                            disabled={uploading}
                            className="hidden"
                            id={inputId}
                        />
                        <label htmlFor={inputId} className="cursor-pointer w-full h-full flex flex-col items-center justify-center">
                            {uploading ? (
                                <div className="w-full px-2">
                                    <div className="text-blue-700 text-[10px] font-bold mb-1.5">Uploading... {progress}%</div>
                                    <div className="w-full bg-blue-200 rounded-full h-1.5">
                                        <div
                                            className="bg-blue-600 h-1.5 rounded-full transition-all"
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="bg-white p-1.5 rounded-full shadow-sm mb-2 group-hover:scale-110 transition-transform">
                                        <svg
                                            className="h-4 w-4 text-blue-500"
                                            stroke="currentColor"
                                            fill="none"
                                            viewBox="0 0 48 48"
                                        >
                                            <path
                                                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                                                strokeWidth={3}
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                    </div>
                                    <p className="text-xs text-blue-700 font-bold">
                                        {preview ? 'Đổi Ảnh Khác' : 'Tải Ảnh Lên'}
                                    </p>
                                    <p className="text-[10px] text-blue-400 mt-0.5">Max 5MB</p>
                                </>
                            )}
                        </label>
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mt-2 text-[10px] text-red-600 font-medium">
                    {error}
                </div>
            )}
        </div>
    )
}
