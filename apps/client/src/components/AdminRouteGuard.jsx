import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const AccessDenied = ({ message }) => (
    <div className="max-w-xl mx-auto rounded-lg border border-red-200 bg-red-50 p-5 text-red-700">
        <h2 className="text-lg font-bold mb-1">Không có quyền truy cập</h2>
        <p className="text-sm">{message}</p>
    </div>
)

export default function AdminRouteGuard({ permission, children }) {
    const location = useLocation()
    const { user, loading, canAccessAdminModule } = useAuth()

    if (loading) {
        return <div className="text-center py-8 text-blue-800 font-medium">Đang tải...</div>
    }

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }

    if (user.role !== 'admin') {
        return <AccessDenied message="Tài khoản của bạn không đủ quyền hạn truy cập." />
    }

    if (permission && !canAccessAdminModule(permission)) {
        return <AccessDenied message="Bạn chưa được cấp quyền vào chức năng này." />
    }

    return children
}
