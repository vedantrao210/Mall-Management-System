import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    if (!getToken()) {
      setReady(true)
      return
    }
    api('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true))
  }, [logout])

  const login = useCallback(async (username, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { username, password } })
    setToken(res.access_token)
    setUser(res.user)
    return res.user
  }, [])

  const value = useMemo(
    () => ({
      user,
      ready,
      login,
      logout,
      hasRole: (...roles) => !!user && roles.includes(user.role),
      canWrite: !!user && ['admin', 'manager'].includes(user.role),
    }),
    [user, ready, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
