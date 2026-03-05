import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'md',
  showCloseButton = true
}) {
  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      // Prevent body scroll
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const maxWidthClasses = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl'
  }

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4">
      {/* Backdrop - click to close */}
      <div
        className="absolute inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        className={`
          relative bg-white rounded-lg border-2 border-blue-400 
          w-full ${maxWidthClasses[maxWidth]} 
          shadow-2xl animate-fade-in
          max-h-[90vh] flex flex-col
        `}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="
            bg-gradient-to-t from-blue-700 to-cyan-500 
            px-4 py-3 
            border-b-2 border-blue-600
            flex justify-between items-center
            rounded-t-md
          ">
            {title && (
              <h3 className="text-lg font-bold text-white drop-shadow-md uppercase tracking-wide">
                {title}
              </h3>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="
                  w-8 h-8 rounded
                  bg-white/20 hover:bg-red-400
                  text-white font-bold text-xl
                  transition-colors
                  flex items-center justify-center
                "
                aria-label="Close"
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="p-4 overflow-y-auto custom-scrollbar">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
