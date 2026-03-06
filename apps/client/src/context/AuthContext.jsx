import { createContext, useContext, useState, useEffect } from 'react'
import { getEffectiveAdminPermissions, hasAdminPermission } from '../constants/adminPermissions'
import { AUTH_EXPIRED_EVENT, clearAuthSession, getValidTokenFromStorage } from '../utils/authSession'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null)
    const [token, setToken] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Load user from localStorage/token on mount, then refresh from /auth/me
        const storedToken = getValidTokenFromStorage()
        const userData = localStorage.getItem('user')
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api'

        const hydrateAuth = async () => {
            if (storedToken && userData) {
                try {
                    const parsedUser = JSON.parse(userData)
                    setUser(parsedUser)
                    setToken(storedToken)

                    try {
                        const res = await fetch(`${API_URL}/auth/me`, {
                            headers: {
                                Authorization: `Bearer ${storedToken}`,
                            },
                        })
                        const data = await res.json().catch(() => null)

                        if (!res.ok) {
                            if (res.status === 401) {
                                clearAuthSession(data?.message || 'Phiên đăng nhập không hợp lệ')
                                setUser(null)
                                setToken(null)
                            }
                            return
                        }

                        if (data?.user) {
                            localStorage.setItem('user', JSON.stringify(data.user))
                            setUser(data.user)
                        }
                    } catch {
                        // Keep cached session if refresh request fails
                    }
                } catch (err) {
                    console.error('Phân tích dữ liệu người dùng thất bại:', err)
                    clearAuthSession('Dữ liệu phiên người dùng không hợp lệ')
                    setUser(null)
                    setToken(null)
                }
            } else {
                setUser(null)
                setToken(null)
            }

            setLoading(false)
        }

        hydrateAuth()
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
