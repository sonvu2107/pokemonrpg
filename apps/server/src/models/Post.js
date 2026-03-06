import mongoose from 'mongoose'

const postSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true,
        },
        content: {
            type: String,
            required: true,
        },
        author: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        mapId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Map',
            default: null,
        },
        type: {
            type: String,
            enum: ['news', 'event', 'maintenance', 'update', 'notification', 'guide'],
            default: 'news',
        },
        imageUrl: {
            type: String,
            trim: true,
            default: '',
        },
        imageUrls: {
            type: [String],
            default: [],
        },
        tags: {
            type: [String],
            default: [],
        },
        isPublished: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
)

// Index for efficient querying
postSchema.index({ isPublished: 1, createdAt: -1 })
postSchema.index({ isPublished: 1, tags: 1, createdAt: -1 })

const Post = mongoose.model('Post', postSchema)

export default Post
