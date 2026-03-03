import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { ChatProvider } from './context/ChatContext'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary>
            <BrowserRouter>
                <AuthProvider>
                    <ToastProvider>
                        <ChatProvider>
                            <App />
                        </ChatProvider>
                    </ToastProvider>
                </AuthProvider>
            </BrowserRouter>
        </ErrorBoundary>
    </React.StrictMode>,
)
