import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
    const location = useLocation()
    const { user, loading } = useAuth()

    if (loading) {
        return <div className="text-center py-8 text-blue-800 font-medium">Đang tải...</div>
    }

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }

    return children
}
