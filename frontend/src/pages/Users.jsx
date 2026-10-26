import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import ResourcePage from '../components/ResourcePage'
import { Badge, ErrorBox, Modal, useToast } from '../components/ui'
import { datetime } from '../format'

const ROLES = ['admin', 'manager', 'staff']

function ResetPassword({ user, onClose }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(null)
  const notify = useToast()
  const submit = async (e) => {
    e.preventDefault()
    try {
      await api(`/users/${user.user_id}/reset-password`, { method: 'POST', body: { new_password: pw } })
      notify(`Password reset for ${user.username}`)
      onClose()
    } catch (err) { setError(err) }
  }
  return (
    <Modal title={`Reset password · ${user.username}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" form="reset-form">Set password</button>
    </>}>
      <form id="reset-form" className="stack" onSubmit={submit}>
        <div className="field"><label>New password</label>
          <input className="input" type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          <span className="help">At least 8 characters. Stored as a bcrypt hash, never in plain text.</span></div>
        <ErrorBox error={error} />
      </form>
    </Modal>
  )
}

export default function Users() {
  const { user: me } = useAuth()
  const [resetting, setResetting] = useState(null)
  return (
    <>
      <ResourcePage
        resource="users" pk="user_id" title="Users" singular="User"
        description="Application accounts. Roles: admin (everything), manager (day-to-day data entry), staff (read-only plus maintenance tickets)."
        canCreate={['admin']} canEdit={['admin']} canDelete={['admin']}
        columns={[
          { key: 'username', label: 'Username', render: (v) => <b className="mono">{v}</b>, sortable: false },
          { key: 'full_name', label: 'Full name', sortable: false },
          { key: 'role', label: 'Role', render: (v) => <Badge value={v} tone={{ admin: 'b-indigo', manager: 'b-blue', staff: 'b-gray' }[v]} />, sortable: false },
          { key: 'is_active', label: 'Active', render: (v) => <Badge value={Number(v) ? 'active' : 'inactive'} />, sortable: false },
          { key: 'last_login_at', label: 'Last login', render: datetime, sortable: false },
          { key: 'created_at', label: 'Created', render: datetime, sortable: false },
        ]}
        defaults={{ role: 'staff', is_active: true }}
        fields={[
          { name: 'username', label: 'Username', required: true, help: '3–50 letters, digits, . _ -' },
          { name: 'full_name', label: 'Full name', required: true },
          { name: 'role', label: 'Role', type: 'select', options: ROLES, required: true },
          { name: 'password', label: 'Password', type: 'password', required: true, help: 'At least 8 characters' },
          { name: 'is_active', label: 'Status', type: 'checkbox', checkboxLabel: 'Account enabled' },
        ]}
        editFields={[
          { name: 'full_name', label: 'Full name', required: true },
          { name: 'role', label: 'Role', type: 'select', options: ROLES, required: true },
          { name: 'is_active', label: 'Status', type: 'checkbox', checkboxLabel: 'Account enabled' },
        ]}
        rowActions={(row) => <button className="link-btn" style={{ marginRight: 12 }} onClick={() => setResetting(row)}>Reset password</button>}
      />
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
      <p className="text-2" style={{ fontSize: 12.5 }}>Signed in as <b>{me.username}</b>. You cannot delete your own account.</p>
    </>
  )
}
