import { createContext, useContext, useState, useEffect } from 'react'
import { getEffectiveAdminPermissions, hasAdminPermission } from '../constants/adminPermissions'
import { AUTH_EXPIRED_EVENT, clearAuthSession, getValidTokenFromStorage } from '../utils/authSession'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Load user from localStorage/token on mount
        const token = getValidTokenFromStorage()
        const userData = localStorage.getItem('user')

        if (token && userData) {
            try {
                setUser(JSON.parse(userData))
            } catch (err) {
                console.error('Phân tích dữ liệu người dùng thất bại:', err)
                clearAuthSession('Dữ liệu phiên người dùng không hợp lệ')
            }
        } else {
            setUser(null)
        }

        setLoading(false)
    }, [])

    useEffect(() => {
        const handleAuthExpired = () => {
            setUser(null)
        }

        window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
        return () => {
            window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
        }
    }, [])

    const login = (userData, token) => {
        localStorage.setItem('token', token)
        localStorage.setItem('user', JSON.stringify(userData))
        setUser(userData)
    }

    const logout = () => {
        clearAuthSession('Logout')
        setUser(null)
    }

    const adminPermissions = getEffectiveAdminPermissions(user)
    const canAccessAdminModule = (permission) => hasAdminPermission(user, permission)

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, adminPermissions, canAccessAdminModule }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth phải được dùng bên trong AuthProvider')
    }
    return context
}
