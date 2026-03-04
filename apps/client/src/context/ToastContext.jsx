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

    const baseClasses = "pointer-events-auto flex items-center min-w-[280px] max-w-sm rounded-lg shadow-lg overflow-hidden transform transition-all duration-300 ease-in-out border-2 animate-slide-in-right";

    let typeClasses = "";
    let iconUrl = "";

    switch (type) {
        case 'success':
            typeClasses = "bg-green-100 border-green-700 text-green-900";
            iconUrl = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/rare-candy.png";
            break;
        case 'error':
            typeClasses = "bg-red-100 border-red-700 text-red-900";
            iconUrl = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/toxic-orb.png";
            break;
        case 'warning':
            typeClasses = "bg-yellow-100 border-yellow-700 text-yellow-900";
            iconUrl = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/full-heal.png";
            break;
        case 'info':
        default:
            typeClasses = "bg-blue-100 border-blue-700 text-blue-900";
            iconUrl = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";
            break;
    }

    return (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none px-4">
            <div className={`${baseClasses} ${typeClasses}`}>
                <div className="flex w-full items-center p-3 border-2 border-transparent relative">
                    <img src={iconUrl} alt={type} className="w-8 h-8 mr-3 filter drop-shadow-sm object-contain pixelated" />
                    <div className="flex-1 pr-4">
                        <p className="font-bold text-sm tracking-wide leading-relaxed font-sans" style={{ textShadow: "1px 1px 0px rgba(255,255,255,0.7)" }}>
                            {message}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="pointer-events-auto absolute top-1 right-2 w-6 h-6 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 transition-colors font-bold text-xs"
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>
                <style>{`
                    @keyframes slideInRight {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                    .animate-slide-in-right {
                        animation: slideInRight 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                    }
                `}</style>
            </div>
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
        throw new Error('useToast phải được dùng bên trong ToastProvider')
    }
    return context
}
