import { Component } from 'react'

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, info) {
        console.error('ErrorBoundary caught:', error, info)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: '100vh',
                    background: '#0f172a',
                    color: '#f1f5f9',
                    fontFamily: 'sans-serif',
                    padding: '24px',
                    textAlign: 'center',
                }}>
                    <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
                    <h1 style={{ fontSize: '20px', marginBottom: '8px' }}>Đã xảy ra lỗi</h1>
                    <p style={{ color: '#94a3b8', marginBottom: '24px', maxWidth: '400px' }}>
                        Trang không thể tải. Vui lòng thử tải lại trang.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '10px 24px',
                            background: '#3b82f6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '14px',
                        }}
                    >
                        Tải lại trang
                    </button>
                </div>
            )
        }

        return this.props.children
    }
}
