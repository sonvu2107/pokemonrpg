import mongoose from 'mongoose'

export const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            // Mongoose 6+ no longer needs these options
            // useNewUrlParser: true,
            // useUnifiedTopology: true,
        })

        console.log(`MongoDB Connected: ${conn.connection.host}`)
    } catch (error) {
        console.error(`MongoDB Connection Error: ${error.message}`)
        process.exit(1)
    }
}
