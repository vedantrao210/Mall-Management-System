import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { Badge, ErrorBox, useToast } from '../components/ui'
import { datetime } from '../format'

const PERMISSIONS = {
  admin: ['Full access to every screen', 'Manage users and reverse payments', 'Download database backups'],
  manager: ['Create and edit shops, tenants, leases, invoices, payments, expenses and employees', 'Run reports and the read-only SQL console', 'Browse schema, objects and the audit log'],
  staff: ['View all operational data and reports', 'Log and update maintenance requests'],
}

export default function Profile() {
  const { user } = useAuth()
  const notify = useToast()
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (form.new_password !== form.confirm) { setError(new Error('The new passwords do not match')); return }
    setBusy(true)
    setError(null)
    try {
      await api('/auth/change-password', { method: 'POST', body: { current_password: form.current_password, new_password: form.new_password } })
      notify('Password changed')
      setForm({ current_password: '', new_password: '', confirm: '' })
    } catch (err) { setError(err) } finally { setBusy(false) }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="card-head"><h3>My account</h3></div>
        <div className="card-body stack">
          <dl className="kv">
            <dt>Username</dt><dd className="mono">{user.username}</dd>
            <dt>Full name</dt><dd>{user.full_name}</dd>
            <dt>Role</dt><dd><Badge value={user.role} tone="b-indigo" /></dd>
            <dt>Last login</dt><dd>{datetime(user.last_login_at)}</dd>
          </dl>
          <div>
            <div className="kpi-label" style={{ marginBottom: 6 }}>What this role can do</div>
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
              {(PERMISSIONS[user.role] || []).map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        </div>
      </div>
      <form className="card" onSubmit={submit}>
        <div className="card-head"><h3>Change password</h3></div>
        <div className="card-body stack">
          <div className="field"><label>Current password</label>
            <input className="input" type="password" required value={form.current_password} onChange={set('current_password')} autoComplete="current-password" /></div>
          <div className="field"><label>New password</label>
            <input className="input" type="password" required minLength={8} value={form.new_password} onChange={set('new_password')} autoComplete="new-password" /></div>
          <div className="field"><label>Confirm new password</label>
            <input className="input" type="password" required minLength={8} value={form.confirm} onChange={set('confirm')} autoComplete="new-password" /></div>
          <ErrorBox error={error} />
          <div><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
        </div>
      </form>
    </div>
  )
}
