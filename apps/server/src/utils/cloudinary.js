import crypto from 'crypto'

const parseCloudinaryUrl = () => {
    const rawUrl = String(process.env.CLOUDINARY_URL || '').trim()
    if (!rawUrl) {
        return { cloudName: '', apiKey: '', apiSecret: '' }
    }

    try {
        const parsed = new URL(rawUrl)
        return {
            cloudName: parsed.hostname || '',
            apiKey: decodeURIComponent(parsed.username || ''),
            apiSecret: decodeURIComponent(parsed.password || ''),
        }
    } catch {
        return { cloudName: '', apiKey: '', apiSecret: '' }
    }
}

const getCloudinaryConfig = () => {
    const fromCloudinaryUrl = parseCloudinaryUrl()
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME || fromCloudinaryUrl.cloudName
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || process.env.VITE_CLOUDINARY_UPLOAD_PRESET
    const apiKey = process.env.CLOUDINARY_API_KEY || fromCloudinaryUrl.apiKey
    const apiSecret = process.env.CLOUDINARY_API_SECRET || fromCloudinaryUrl.apiSecret
    const specialPokemonFolder = process.env.CLOUDINARY_SPECIAL_POKEMON_FOLDER || 'pokemon/special-pokemon'
    const mapImageFolder = process.env.CLOUDINARY_MAP_IMAGE_FOLDER || 'pokemon/map-images'
    const vipAssetFolder = process.env.CLOUDINARY_VIP_ASSET_FOLDER || 'pokemon/vip-assets'
    return { cloudName, uploadPreset, apiKey, apiSecret, specialPokemonFolder, mapImageFolder, vipAssetFolder }
}

const parseCloudinaryError = async (response) => {
    try {
        const data = await response.json()
        return data?.error?.message || data?.message || 'Cloudinary upload failed'
    } catch {
        return 'Cloudinary upload failed'
    }
}

const uploadImageToCloudinary = async ({ buffer, mimetype, originalname, folder }) => {
    const { cloudName, uploadPreset, apiKey, apiSecret } = getCloudinaryConfig()

    if (!cloudName) {
        throw new Error('Cloudinary is not configured. Missing CLOUDINARY_CLOUD_NAME or CLOUDINARY_URL.')
    }

    if (!uploadPreset && (!apiKey || !apiSecret)) {
        throw new Error('Cloudinary is not configured. Provide CLOUDINARY_UPLOAD_PRESET or CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET (or CLOUDINARY_URL).')
    }

    if (!buffer || !mimetype) {
        throw new Error('Invalid image file payload')
    }

    const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`
    const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`

    const formData = new FormData()
    formData.append('file', dataUri)

    if (uploadPreset) {
        formData.append('upload_preset', uploadPreset)
        if (folder) formData.append('folder', folder)
        if (originalname) {
            formData.append('filename_override', originalname)
        }
    } else {
        const timestamp = Math.floor(Date.now() / 1000)
        const paramsToSign = {}
        if (folder) paramsToSign.folder = folder
        paramsToSign.timestamp = String(timestamp)

        const signaturePayload = Object.keys(paramsToSign)
            .sort()
            .map((key) => `${key}=${paramsToSign[key]}`)
            .join('&')

        const signature = crypto
            .createHash('sha1')
            .update(`${signaturePayload}${apiSecret}`)
            .digest('hex')

        if (folder) formData.append('folder', folder)
        formData.append('api_key', apiKey)
        formData.append('timestamp', String(timestamp))
        formData.append('signature', signature)
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        body: formData,
    })

    if (!response.ok) {
        const message = await parseCloudinaryError(response)
        throw new Error(message)
    }

    const data = await response.json()
    return {
        imageUrl: data.secure_url || data.url,
        publicId: data.public_id || '',
    }
}

export const uploadSpecialPokemonImageToCloudinary = async ({ buffer, mimetype, originalname }) => {
    const { specialPokemonFolder } = getCloudinaryConfig()
    return uploadImageToCloudinary({
        buffer,
        mimetype,
        originalname,
        folder: specialPokemonFolder,
    })
}

export const uploadMapImageToCloudinary = async ({ buffer, mimetype, originalname }) => {
    const { mapImageFolder } = getCloudinaryConfig()
    return uploadImageToCloudinary({
        buffer,
        mimetype,
        originalname,
        folder: mapImageFolder,
    })
}

export const uploadVipAssetImageToCloudinary = async ({ buffer, mimetype, originalname }) => {
    const { vipAssetFolder } = getCloudinaryConfig()
    return uploadImageToCloudinary({
        buffer,
        mimetype,
        originalname,
        folder: vipAssetFolder,
    })
}
