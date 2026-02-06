const getCloudinaryConfig = () => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.VITE_CLOUDINARY_CLOUD_NAME
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || process.env.VITE_CLOUDINARY_UPLOAD_PRESET
    const specialPokemonFolder = process.env.CLOUDINARY_SPECIAL_POKEMON_FOLDER || 'pokemon/special-pokemon'
    const mapImageFolder = process.env.CLOUDINARY_MAP_IMAGE_FOLDER || 'pokemon/map-images'
    return { cloudName, uploadPreset, specialPokemonFolder, mapImageFolder }
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
    const { cloudName, uploadPreset } = getCloudinaryConfig()

    if (!cloudName || !uploadPreset) {
        throw new Error('Cloudinary is not configured. Missing CLOUDINARY_CLOUD_NAME/CLOUDINARY_UPLOAD_PRESET.')
    }

    if (!buffer || !mimetype) {
        throw new Error('Invalid image file payload')
    }

    const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`
    const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`

    const formData = new FormData()
    formData.append('file', dataUri)
    formData.append('upload_preset', uploadPreset)
    if (folder) formData.append('folder', folder)
    if (originalname) {
        formData.append('filename_override', originalname)
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
