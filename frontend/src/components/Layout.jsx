import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import Icon from './Icons'

export const NAV = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: 'dashboard' }] },
  {
    group: 'Property',
    items: [
      { to: '/shops', label: 'Shops', icon: 'shop' },
      { to: '/tenants', label: 'Tenants', icon: 'users' },
      { to: '/leases', label: 'Leases', icon: 'file' },
    ],
  },
  {
    group: 'Finance',
    items: [
      { to: '/invoices', label: 'Invoices', icon: 'invoice' },
      { to: '/payments', label: 'Payments', icon: 'cash' },
      { to: '/expenses', label: 'Expenses', icon: 'receipt' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { to: '/employees', label: 'Employees', icon: 'badge' },
      { to: '/maintenance', label: 'Maintenance', icon: 'tool' },
    ],
  },
  { group: 'Insights', items: [{ to: '/reports', label: 'Reports', icon: 'chart' }] },
  {
    group: 'Administration',
    items: [
      { to: '/setup', label: 'Master data', icon: 'layers', roles: ['admin', 'manager'] },
      { to: '/database', label: 'Database', icon: 'database', roles: ['admin', 'manager'] },
      { to: '/users', label: 'Users', icon: 'shield', roles: ['admin'] },
    ],
  },
]

const TITLES = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.to, i.label])))

export default function Layout() {
  const { user, logout, hasRole } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const base = '/' + (location.pathname.split('/')[1] || '')
  const title = TITLES[base] || (base === '/profile' ? 'My account' : 'Mall Management System')

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M3 21V9l9-6 9 6v12h-7v-7h-4v7z" /></svg>
          </div>
          <div>Mall Manager<small>Database Systems Project</small></div>
        </div>
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.roles || hasRole(...i.roles))
          if (!items.length) return null
          return (
            <div className="nav-group" key={g.group}>
              <div className="nav-group-title">{g.group}</div>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} className="nav-link">
                  <Icon name={i.icon} /> {i.label}
                </NavLink>
              ))}
            </div>
          )
        })}
        <div className="sidebar-foot">React · FastAPI · MySQL 8</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="user-chip">
            <button className="btn btn-ghost" onClick={() => navigate('/profile')} title="My account">
              <div className="avatar">{user.full_name?.[0] || user.username[0]}</div>
              <div className="user-meta" style={{ textAlign: 'left' }}>
                <b>{user.full_name}</b>
                <span>{user.role}</span>
              </div>
            </button>
            <button className="btn btn-sm" onClick={logout}><Icon name="logout" /> Sign out</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
