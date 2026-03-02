import { createContext, useContext, useState, useEffect } from 'react'
import { getEffectiveAdminPermissions, hasAdminPermission } from '../constants/adminPermissions'
import { AUTH_EXPIRED_EVENT, clearAuthSession, getValidTokenFromStorage } from '../utils/authSession'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null)
    const [token, setToken] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Load user from localStorage/token on mount
        const storedToken = getValidTokenFromStorage()
        const userData = localStorage.getItem('user')

        if (storedToken && userData) {
            try {
                setUser(JSON.parse(userData))
                setToken(storedToken)
            } catch (err) {
                console.error('Phân tích dữ liệu người dùng thất bại:', err)
                clearAuthSession('Dữ liệu phiên người dùng không hợp lệ')
            }
        } else {
            setUser(null)
            setToken(null)
        }

        setLoading(false)
    }, [])

    useEffect(() => {
        const handleAuthExpired = () => {
            setUser(null)
            setToken(null)
        }

        window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
        return () => {
            window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired)
        }
    }, [])

    const login = (userData, authToken) => {
        localStorage.setItem('token', authToken)
        localStorage.setItem('user', JSON.stringify(userData))
        setUser(userData)
        setToken(authToken)
    }

    const logout = () => {
        clearAuthSession('Logout')
        setUser(null)
        setToken(null)
    }

    const adminPermissions = getEffectiveAdminPermissions(user)
    const canAccessAdminModule = (permission) => hasAdminPermission(user, permission)

    return (
        <AuthContext.Provider value={{ user, token, loading, login, logout, adminPermissions, canAccessAdminModule }}>
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
