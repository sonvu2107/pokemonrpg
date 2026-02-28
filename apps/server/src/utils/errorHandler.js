// Centralized error handler middleware
export const errorHandler = (err, req, res, next) => {
    console.error('Error:', {
        requestId: req.requestId || null,
        path: req.originalUrl,
        method: req.method,
        message: err.message,
        stack: err.stack,
    })

    const statusCode = err.statusCode || 500
    const message = err.message || 'Internal Server Error'

    res.status(statusCode).json({
        ok: false,
        message,
        requestId: req.requestId || null,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    })
}

// Not found handler
export const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`)
    error.statusCode = 404
    next(error)
}
