import { createContext, useContext, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

const ToastContext = createContext(null);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

let toastId = 0;

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const addToast = useCallback((message, type = 'info', duration = 3000) => {
        const id = ++toastId;
        setToasts(prev => [...prev, { id, message, type }]);

        if (duration > 0) {
            setTimeout(() => {
                removeToast(id);
            }, duration);
        }
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);

    const toast = {
        success: (message, duration) => addToast(message, 'success', duration),
        error: (message, duration) => addToast(message, 'error', duration),
        info: (message, duration) => addToast(message, 'info', duration),
    };

    return (
        <ToastContext.Provider value={toast}>
            {children}
            {createPortal(
                <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none px-4">
                    {toasts.map(t => (
                        <ToastItem key={t.id} toast={t} onRemove={() => removeToast(t.id)} />
                    ))}
                </div>,
                document.body
            )}
        </ToastContext.Provider>
    );
};

const ToastItem = ({ toast, onRemove }) => {
    const baseClasses = "pointer-events-auto flex items-center min-w-[280px] max-w-sm rounded-lg shadow-lg overflow-hidden transform transition-all duration-300 ease-in-out border-2 animate-slide-in-right";

    let typeClasses = "";
    let icon = "";

    switch (toast.type) {
        case 'success':
            typeClasses = "bg-green-100 border-green-700 text-green-900";
            icon = "🌟";
            break;
        case 'error':
            typeClasses = "bg-red-100 border-red-700 text-red-900";
            icon = "❌";
            break;
        case 'info':
        default:
            typeClasses = "bg-blue-100 border-blue-700 text-blue-900";
            icon = "💬";
            break;
    }

    return (
        <div className={`${baseClasses} ${typeClasses}`}>
            <div className="flex w-full items-start p-3 border-2 border-transparent relative">
                <div className="text-xl mr-3 mt-0.5 filter drop-shadow-sm">{icon}</div>
                <div className="flex-1">
                    <p className="font-bold text-sm tracking-wide leading-relaxed font-sans" style={{ textShadow: "1px 1px 0px rgba(255,255,255,0.7)" }}>
                        {toast.message}
                    </p>
                </div>
                <button
                    onClick={onRemove}
                    className="ml-2 text-slate-500 hover:text-slate-800 transition-colors bg-white/50 rounded-full w-6 h-6 flex items-center justify-center font-bold text-xs"
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
    );
};
