import { useState } from 'react'
import { useAuth } from '../auth'
import Icon from '../components/Icons'
import { ErrorBox } from '../components/ui'

const DEMO = [
  { username: 'admin', password: 'Admin@123', role: 'Admin' },
  { username: 'manager', password: 'Manager@123', role: 'Manager' },
  { username: 'staff', password: 'Staff@123', role: 'Staff' },
]

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(username, password)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-logo">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M3 21V9l9-6 9 6v12h-7v-7h-4v7z" /></svg>
          </div>
          <div>Mall Manager<small>Database Systems Project</small></div>
        </div>
        <div>
          <h2>Manage shops, tenants, leases and billing, all backed by MySQL.</h2>
          <ul>
            <li><Icon name="database" /> Normalised schema with keys, constraints and indexes</li>
            <li><Icon name="code" /> Views, stored procedures, functions, triggers and events</li>
            <li><Icon name="shield" /> Role-based access and least-privilege database accounts</li>
            <li><Icon name="history" /> Automatic audit trail and transaction-safe payments</li>
          </ul>
        </div>
        <div style={{ fontSize: 12, color: '#a5b4fc' }}>React · FastAPI · MySQL 8</div>
      </section>
      <section className="login-form-wrap">
        <form className="login-card stack" onSubmit={submit}>
          <div>
            <h1>Sign in</h1>
            <p className="text-2" style={{ margin: '6px 0 0' }}>Use your account to access the system.</p>
          </div>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" className="input" autoComplete="username" value={username}
              onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" className="input" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <ErrorBox error={error} />
          <button className="btn btn-primary" style={{ height: 40 }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="demo-accounts">
            <div className="text-2" style={{ fontSize: 12.5 }}>Demo accounts (from the seed data). Click one to fill the form:</div>
            {DEMO.map((d) => (
              <button type="button" key={d.username} className="btn btn-sm"
                onClick={() => { setUsername(d.username); setPassword(d.password) }}>
                {d.role}
              </button>
            ))}
          </div>
        </form>
      </section>
    </div>
  )
}
