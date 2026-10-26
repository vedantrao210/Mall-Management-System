import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './components/Layout'
import { Spinner, ToastProvider } from './components/ui'
import Dashboard from './pages/Dashboard'
import Database from './pages/Database'
import Login from './pages/Login'
import Profile from './pages/Profile'
import Reports from './pages/Reports'
import Setup from './pages/Setup'
import Users from './pages/Users'
import { Employees, Expenses, Invoices, Leases, Maintenance, Payments, Shops, Tenants } from './pages/Entities'

function Protected({ children, roles }) {
  const { user, ready, hasRole } = useAuth()
  if (!ready) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  if (roles && !hasRole(...roles)) return <Navigate to="/" replace />
  return children
}

function LoginRoute() {
  const { user, ready } = useAuth()
  if (!ready) return <Spinner />
  return user ? <Navigate to="/" replace /> : <Login />
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route index element={<Dashboard />} />
              <Route path="shops" element={<Shops />} />
              <Route path="tenants" element={<Tenants />} />
              <Route path="leases" element={<Leases />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="payments" element={<Payments />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="employees" element={<Employees />} />
              <Route path="maintenance" element={<Maintenance />} />
              <Route path="reports" element={<Reports />} />
              <Route path="setup" element={<Protected roles={['admin', 'manager']}><Setup /></Protected>} />
              <Route path="database" element={<Protected roles={['admin', 'manager']}><Database /></Protected>} />
              <Route path="users" element={<Protected roles={['admin']}><Users /></Protected>} />
              <Route path="profile" element={<Profile />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}
