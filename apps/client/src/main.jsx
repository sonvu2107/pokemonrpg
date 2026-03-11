import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { PlayTabProvider } from './context/PlayTabContext'
import { ToastProvider } from './context/ToastContext'
import { ChatProvider } from './context/ChatContext'
import ErrorBoundary from './components/ErrorBoundary'
import App from './App.jsx'
import { installGlobalRateLimitWatcher } from './utils/rateLimitWatcher'
import './index.css'

installGlobalRateLimitWatcher()

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnReconnect: true,
            refetchOnWindowFocus: false,
        },
    },
})

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <BrowserRouter>
                    <AuthProvider>
                        <PlayTabProvider>
                            <ToastProvider>
                                <ChatProvider>
                                    <App />
                                </ChatProvider>
                            </ToastProvider>
                        </PlayTabProvider>
                    </AuthProvider>
                </BrowserRouter>
            </QueryClientProvider>
        </ErrorBoundary>
    </React.StrictMode>,
)
