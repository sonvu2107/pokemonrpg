// Centralized error handler middleware
export const errorHandler = (err, req, res, next) => {
    console.error('Error:', err)

    const statusCode = err.statusCode || 500
    const message = err.message || 'Internal Server Error'

    res.status(statusCode).json({
        ok: false,
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    })
}

// Not found handler
export const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`)
    error.statusCode = 404
    next(error)
}
