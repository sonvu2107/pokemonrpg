// Centralized error handler middleware
export const errorHandler = (err, req, res, next) => {
    const statusCode = err.statusCode || 500
    const message = err.message || 'Internal Server Error'

    const logPayload = {
        requestId: req.requestId || null,
        path: req.originalUrl,
        method: req.method,
        statusCode,
        message,
    }

    if (statusCode >= 500) {
        console.error('Error:', {
            ...logPayload,
            stack: err.stack,
        })
    } else if (statusCode === 404) {
        console.warn('Not Found:', logPayload)
    } else {
        console.warn('Request Error:', logPayload)
    }

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
