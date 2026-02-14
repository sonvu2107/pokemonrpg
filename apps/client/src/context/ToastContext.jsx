import { createContext, useContext, useState, useEffect } from 'react'

const ToastContext = createContext(null)

// Simple Toast Component
const Toast = ({ message, type, onClose }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose()
        }, 3000)
        return () => clearTimeout(timer)
    }, [onClose])

    const bgColors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
        warning: 'bg-yellow-500'
    }

    return (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded shadow-lg text-white font-bold animate-fade-in-down ${bgColors[type] || bgColors.info}`}>
            {message}
        </div>
    )
}

export const ToastProvider = ({ children }) => {
    const [toast, setToast] = useState(null)

    const showToast = (message, type = 'info') => {
        setToast({ message, type })
    }

    const showSuccess = (message) => showToast(message, 'success')
    const showError = (message) => showToast(message, 'error')
    const showInfo = (message) => showToast(message, 'info')
    const showWarning = (message) => showToast(message, 'warning')

    const closeToast = () => {
        setToast(null)
    }

    return (
        <ToastContext.Provider value={{ showToast, showSuccess, showError, showInfo, showWarning }}>
            {children}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={closeToast}
                />
            )}
        </ToastContext.Provider>
    )
}

export const useToast = () => {
    const context = useContext(ToastContext)
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider')
    }
    return context
}
