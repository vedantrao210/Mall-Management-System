// Business screens. Each one is mostly configuration for <ResourcePage/>,
// plus a few actions that call stored procedures through the API.
import { useState } from 'react'
import { api, download } from '../api'
import { useAuth } from '../auth'
import Icon from '../components/Icons'
import ResourcePage from '../components/ResourcePage'
import {
  Badge, ConfirmDialog, ErrorBox, FormGrid, Modal, ResultTable, Spinner, coerce, useApi, useToast,
} from '../components/ui'
import { date, datetime, money, num, today } from '../format'

const yesNo = (v) => <Badge value={Number(v) ? 'yes' : 'no'} />

/* ======================================================================= Shops */
export function Shops() {
  return (
    <ResourcePage
      resource="shops" pk="shop_id" title="Shops" singular="Shop"
      description="Rentable units. Status changes to occupied / vacant automatically through lease triggers."
      defaultSort="unit_code"
      columns={[
        { key: 'unit_code', label: 'Unit', render: (v) => <b>{v}</b> },
        { key: 'floor_name', label: 'Floor', sortKey: 'level_number' },
        { key: 'category_name', label: 'Category' },
        { key: 'area_sqft', label: 'Area (sq ft)', num: true, render: num },
        { key: 'base_rent', label: 'Base rent', num: true, render: money },
        { key: 'status', label: 'Status', render: (v) => <Badge value={v} /> },
        { key: 'current_tenant', label: 'Current tenant' },
        { key: 'current_rent', label: 'Lease rent', num: true, render: money },
      ]}
      filters={[
        { name: 'status', label: 'Status', options: ['vacant', 'occupied', 'under_maintenance'] },
        { name: 'floor_id', label: 'Floor', optionsFrom: 'floors' },
        { name: 'category_id', label: 'Category', optionsFrom: 'shop-categories' },
      ]}
      defaults={{ status: 'vacant' }}
      fields={[
        { name: 'unit_code', label: 'Unit code', required: true, placeholder: 'e.g. G-08', help: 'Letters, digits and dashes' },
        { name: 'floor_id', label: 'Floor', type: 'select', optionsFrom: 'floors', required: true },
        { name: 'category_id', label: 'Category', type: 'select', optionsFrom: 'shop-categories' },
        { name: 'area_sqft', label: 'Area (sq ft)', type: 'number', step: '0.01', min: '0.01', required: true },
        { name: 'base_rent', label: 'Base rent / month', type: 'number', step: '0.01', min: '0', required: true },
        { name: 'status', label: 'Status', type: 'select', options: ['vacant', 'occupied', 'under_maintenance'], required: true,
          help: '“Occupied” is only accepted when an active lease exists (trigger rule)' },
      ]}
    />
  )
}

/* ===================================================================== Tenants */
function TenantStatement({ tenant, onClose }) {
  const { data, loading, error } = useApi(`/reports/tenant-statement/${tenant.tenant_id}`)
  const notify = useToast()
  return (
    <Modal wide title={`Account statement · ${tenant.business_name}`} onClose={onClose} footer={<>
      <button className="btn" onClick={() => download(`/reports/tenant-statement/${tenant.tenant_id}`, { format: 'csv' })
        .catch((e) => notify(e.message, 'error'))}><Icon name="download" /> CSV</button>
      <button className="btn btn-primary" onClick={onClose}>Close</button>
    </>}>
      {loading && <Spinner />}
      <ErrorBox error={error} />
      {data && (
        <div className="stack">
          <div className="grid grid-4">
            <Mini label="Active leases" value={data.tenant.active_leases} />
            <Mini label="Total invoiced" value={money(data.tenant.total_invoiced)} />
            <Mini label="Total paid" value={money(data.tenant.total_paid)} />
            <Mini label="Outstanding" value={money(data.tenant.outstanding)} danger={data.tenant.outstanding > 0} />
          </div>
          <div className="sql-inline">{data.sql}  -- window function: SUM(debit - credit) OVER (ORDER BY txn_date …)</div>
          <div className="card"><ResultTable columns={data.columns} rows={data.rows} maxHeight={420} /></div>
        </div>
      )}
    </Modal>
  )
}

function Mini({ label, value, danger }) {
  return (
    <div className="card" style={{ padding: '10px 14px' }}>
      <div className="kpi-label">{label}</div>
      <div style={{ fontWeight: 700, fontSize: 17, marginTop: 2 }} className={danger ? 'danger-text' : ''}>{value}</div>
    </div>
  )
}

export function Tenants() {
  const [statement, setStatement] = useState(null)
  return (
    <>
      <ResourcePage
        resource="tenants" pk="tenant_id" title="Tenants" singular="Tenant"
        description="Businesses renting units. Balances come from the v_tenant_balances view."
        defaultSort="business_name"
        columns={[
          { key: 'business_name', label: 'Business', render: (v, r) => <><b>{v}</b>{r.tax_id && <span className="cell-sub">{r.tax_id}</span>}</> },
          { key: 'contact_person', label: 'Contact' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone', nowrap: true },
          { key: 'active_leases', label: 'Leases', num: true },
          { key: 'outstanding', label: 'Outstanding', num: true, render: money },
          { key: 'overdue_amount', label: 'Overdue', num: true,
            render: (v) => <span className={v > 0 ? 'danger-text' : ''}>{money(v)}</span> },
        ]}
        fields={[
          { name: 'business_name', label: 'Business name', required: true, full: true },
          { name: 'contact_person', label: 'Contact person', required: true },
          { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'phone', label: 'Phone', required: true, help: '7–20 digits, spaces, + - ( )' },
          { name: 'tax_id', label: 'Tax registration no.' },
        ]}
        rowActions={(row) => <button className="link-btn" onClick={() => setStatement(row)} style={{ marginRight: 12 }}>Statement</button>}
      />
      {statement && <TenantStatement tenant={statement} onClose={() => setStatement(null)} />}
    </>
  )
}

/* ====================================================================== Leases */
function TerminateLease({ lease, onClose, onDone }) {
  const [endDate, setEndDate] = useState(today())
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const notify = useToast()
  const submit = async () => {
    setBusy(true)
    try {
      const res = await api(`/leases/${lease.lease_id}/terminate`, { method: 'POST', body: { end_date: endDate } })
      notify(`Lease terminated · ${res.voided_invoices} future invoice(s) voided`)
      onDone()
      onClose()
    } catch (e) { setError(e); setBusy(false) }
  }
  return (
    <Modal title={`Terminate lease #${lease.lease_id}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-danger" disabled={busy} onClick={submit}>{busy ? 'Working…' : 'Terminate lease'}</button>
    </>}>
      <div className="stack">
        <div className="alert alert-info">
          Runs <code>sp_terminate_lease</code> in one transaction: sets the lease to <b>terminated</b>, voids unpaid
          invoices after the end date, and a trigger marks shop <b>{lease.unit_code}</b> as vacant.
        </div>
        <div className="field"><label>Termination date</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  )
}

export function Leases() {
  const { canWrite } = useAuth()
  const notify = useToast()
  const [terminating, setTerminating] = useState(null)
  const [reloadFn, setReloadFn] = useState(() => () => {})
  return (
    <>
      <ResourcePage
        resource="leases" pk="lease_id" title="Leases" singular="Lease"
        description="Agreements between tenants and shops. A shop can have only one active lease (trigger + unique index on a generated column)."
        defaultSort="lease_id" defaultOrder="desc"
        canDelete={['admin']}
        columns={[
          { key: 'lease_id', label: '#', render: (v) => <span className="muted">#{v}</span> },
          { key: 'unit_code', label: 'Unit', render: (v) => <b>{v}</b> },
          { key: 'business_name', label: 'Tenant' },
          { key: 'start_date', label: 'Start', render: date, nowrap: true },
          { key: 'end_date', label: 'End', render: date, nowrap: true },
          { key: 'monthly_rent', label: 'Rent / month', num: true, render: money },
          { key: 'tax_rate', label: 'Tax %', num: true, render: num },
          { key: 'status', label: 'Status', render: (v) => <Badge value={v} /> },
          { key: 'days_remaining', label: 'Days left', num: true,
            render: (v) => v === null ? '—' : <span className={v <= 90 ? 'danger-text' : ''}>{num(v)}</span> },
        ]}
        filters={[{ name: 'status', label: 'Status', options: ['active', 'terminated', 'expired'] }]}
        defaults={{ start_date: today(), tax_rate: 18, security_deposit: 0 }}
        fields={[
          { name: 'shop_id', label: 'Shop', type: 'select', optionsFrom: 'shops', required: true, help: 'Must be vacant' },
          { name: 'tenant_id', label: 'Tenant', type: 'select', optionsFrom: 'tenants', required: true },
          { name: 'start_date', label: 'Start date', type: 'date', required: true },
          { name: 'end_date', label: 'End date', type: 'date', required: true },
          { name: 'monthly_rent', label: 'Monthly rent', type: 'number', step: '0.01', min: '0.01', required: true },
          { name: 'security_deposit', label: 'Security deposit', type: 'number', step: '0.01', min: '0' },
          { name: 'tax_rate', label: 'Tax rate %', type: 'number', step: '0.01', min: '0', max: '100' },
        ]}
        editFields={[
          { name: 'end_date', label: 'End date', type: 'date', required: true },
          { name: 'monthly_rent', label: 'Monthly rent', type: 'number', step: '0.01', min: '0.01', required: true },
          { name: 'security_deposit', label: 'Security deposit', type: 'number', step: '0.01', min: '0' },
          { name: 'tax_rate', label: 'Tax rate %', type: 'number', step: '0.01', min: '0', max: '100' },
        ]}
        toolbar={(reload) => canWrite && (
          <button className="btn" onClick={async () => {
            try {
              const r = await api('/leases/expire', { method: 'POST' })
              notify(`Expiry job finished · ${r.expired} lease(s) expired`)
              reload()
            } catch (e) { notify(e.message, 'error') }
          }} title="CALL sp_expire_leases() — also runs nightly as a MySQL EVENT"><Icon name="refresh" /> Run expiry job</button>
        )}
        rowActions={(row, reload) => canWrite && row.status === 'active' && (
          <button className="link-btn danger" style={{ marginRight: 12 }}
            onClick={() => { setReloadFn(() => reload); setTerminating(row) }}>Terminate</button>
        )}
      />
      {terminating && <TerminateLease lease={terminating} onClose={() => setTerminating(null)} onDone={reloadFn} />}
    </>
  )
}

/* ==================================================================== Invoices */
function GenerateInvoices({ onClose, onDone }) {
  const [values, setValues] = useState({ month: today().slice(0, 7), due_days: 10 })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const notify = useToast()
  const submit = async () => {
    setBusy(true)
    try {
      const r = await api('/invoices/generate', { method: 'POST', body: { month: `${values.month}-01`, due_days: Number(values.due_days) } })
      notify(r.created ? `${r.created} invoice(s) generated for ${r.month.slice(0, 7)}` : `No new invoices: ${r.month.slice(0, 7)} is already billed`)
      onDone()
      onClose()
    } catch (e) { setError(e); setBusy(false) }
  }
  return (
    <Modal title="Generate monthly invoices" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Generating…' : 'Generate'}</button>
    </>}>
      <div className="stack">
        <div className="alert alert-info">
          Calls <code>sp_generate_invoices</code>: one set-based <code>INSERT … SELECT</code> for every lease in force
          during the month. Safe to run repeatedly; the <code>UNIQUE (lease_id, billing_month)</code> key and a
          <code> NOT EXISTS</code> check prevent duplicates. Tax and total are generated columns.
        </div>
        <div className="form-grid">
          <div className="field"><label>Billing month</label>
            <input className="input" type="month" value={values.month} onChange={(e) => setValues({ ...values, month: e.target.value })} /></div>
          <div className="field"><label>Due after (days)</label>
            <input className="input" type="number" min="0" max="60" value={values.due_days}
              onChange={(e) => setValues({ ...values, due_days: e.target.value })} /></div>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  )
}

const PAYMENT_FIELDS = [
  { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: '0.01', required: true },
  { name: 'payment_date', label: 'Payment date', type: 'date', required: true },
  { name: 'method', label: 'Method', type: 'select', required: true, options: ['bank_transfer', 'online', 'card', 'cheque', 'cash'] },
  { name: 'reference_no', label: 'Reference no.' },
]

function RecordPayment({ invoice, onClose, onDone }) {
  const [values, setValues] = useState({ amount: invoice.balance_due, payment_date: today(), method: 'bank_transfer', reference_no: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const notify = useToast()
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await api('/payments', { method: 'POST', body: { invoice_id: invoice.invoice_id, ...coerce(PAYMENT_FIELDS, values) } })
      notify(`Payment recorded · invoice is now ${r.invoice.status.replace('_', ' ')}`)
      onDone()
      onClose()
    } catch (err) { setError(err); setBusy(false) }
  }
  return (
    <Modal title={`Record payment · ${invoice.invoice_no}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" form="pay-form" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
    </>}>
      <form id="pay-form" className="stack" onSubmit={submit}>
        <dl className="kv">
          <dt>Tenant</dt><dd>{invoice.business_name} · unit {invoice.unit_code}</dd>
          <dt>Period</dt><dd>{invoice.period}</dd>
          <dt>Total</dt><dd>{money(invoice.total_amount)}</dd>
          <dt>Already paid</dt><dd>{money(invoice.amount_paid)}</dd>
          <dt>Balance due</dt><dd><b>{money(invoice.balance_due)}</b></dd>
        </dl>
        <div className="alert alert-info">
          Runs <code>sp_record_payment</code> inside a transaction with <code>SELECT … FOR UPDATE</code>.
          Over-payments are rejected; a trigger updates the invoice status.
        </div>
        <FormGrid fields={PAYMENT_FIELDS} values={values} onChange={setValues} />
        <ErrorBox error={error} />
      </form>
    </Modal>
  )
}

function InvoicePayments({ invoice, onClose }) {
  const { data, loading, error } = useApi(`/invoices/${invoice.invoice_id}/payments`)
  return (
    <Modal wide title={`Payments · ${invoice.invoice_no}`} onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}>Close</button>}>
      {loading && <Spinner />}
      <ErrorBox error={error} />
      {data && (data.length === 0 ? <div className="empty">No payments recorded yet</div> : (
        <div className="card"><ResultTable rows={data}
          columns={['payment_id', 'payment_date', 'amount', 'method', 'reference_no', 'recorded_by']} /></div>
      ))}
    </Modal>
  )
}

export function Invoices() {
  const { canWrite } = useAuth()
  const notify = useToast()
  const [modal, setModal] = useState(null) // {type, invoice, reload}
  return (
    <>
      <ResourcePage
        resource="invoices" pk="invoice_id" title="Invoices" singular="Invoice"
        description="Monthly rent bills. Paid amount, balance and overdue days come from the v_invoice_summary view."
        defaultSort="billing_month" defaultOrder="desc"
        canEdit={[]} canDelete={[]}
        columns={[
          { key: 'invoice_no', label: 'Invoice', render: (v) => <b className="mono" style={{ fontSize: 12.5 }}>{v}</b> },
          { key: 'business_name', label: 'Tenant', render: (v, r) => <>{v}<span className="cell-sub">Unit {r.unit_code}</span></> },
          { key: 'period', label: 'Period', sortKey: 'billing_month',
            render: (v, r) => <>{v}<span className="cell-sub">Due {date(r.due_date)}</span></> },
          { key: 'total_amount', label: 'Total', num: true, render: money },
          { key: 'balance_due', label: 'Balance', num: true, render: (v, r) => <>{money(v)}<span className="cell-sub">paid {money(r.amount_paid)}</span></> },
          { key: 'status', label: 'Status', render: (v) => <Badge value={v} /> },
          { key: 'days_overdue', label: 'Overdue', num: true,
            render: (v) => v > 0 ? <span className="danger-text">{v} d</span> : <span className="muted">—</span> },
        ]}
        filters={[
          { name: 'status', label: 'Status', options: ['unpaid', 'partially_paid', 'paid', 'void'] },
          { name: 'is_overdue', label: 'Overdue', options: [{ value: '1', label: 'Overdue only' }] },
          { name: 'tenant_id', label: 'Tenant', optionsFrom: 'tenants' },
        ]}
        toolbar={(reload) => canWrite && (
          <button className="btn btn-primary" onClick={() => setModal({ type: 'generate', reload })}>
            <Icon name="calendar" /> Generate invoices
          </button>
        )}
        rowActions={(row, reload) => (
          <>
            <button className="link-btn" onClick={() => setModal({ type: 'payments', invoice: row })}>History</button>
            {canWrite && ['unpaid', 'partially_paid'].includes(row.status) && (
              <button className="link-btn" style={{ marginLeft: 12 }} onClick={() => setModal({ type: 'pay', invoice: row, reload })}>Pay</button>
            )}
            {canWrite && row.status === 'unpaid' && (
              <button className="link-btn danger" style={{ marginLeft: 12 }} onClick={() => setModal({ type: 'void', invoice: row, reload })}>Void</button>
            )}
          </>
        )}
      />
      {modal?.type === 'generate' && <GenerateInvoices onClose={() => setModal(null)} onDone={modal.reload} />}
      {modal?.type === 'pay' && <RecordPayment invoice={modal.invoice} onClose={() => setModal(null)} onDone={modal.reload} />}
      {modal?.type === 'payments' && <InvoicePayments invoice={modal.invoice} onClose={() => setModal(null)} />}
      {modal?.type === 'void' && (
        <ConfirmDialog title={`Void ${modal.invoice.invoice_no}`} danger confirmText="Void invoice"
          message="The invoice will be kept for the record but excluded from balances. A trigger blocks voiding if any payment exists."
          onConfirm={async () => { await api(`/invoices/${modal.invoice.invoice_id}/void`, { method: 'POST' }); notify('Invoice voided'); modal.reload() }}
          onClose={() => setModal(null)} />
      )}
    </>
  )
}

/* ==================================================================== Payments */
export function Payments() {
  return (
    <ResourcePage
      resource="payments" pk="payment_id" title="Payments" singular="Payment"
      description="Money received. Payments are immutable (a trigger blocks UPDATE); an admin can reverse one by deleting it, which re-computes the invoice status."
      defaultSort="payment_date" defaultOrder="desc"
      canEdit={[]} canDelete={['admin']} deleteLabel="Reverse"
      columns={[
        { key: 'payment_id', label: '#', render: (v) => <span className="muted">#{v}</span> },
        { key: 'payment_date', label: 'Date', render: date, nowrap: true },
        { key: 'invoice_no', label: 'Invoice', render: (v) => <span className="mono" style={{ fontSize: 12.5 }}>{v}</span> },
        { key: 'business_name', label: 'Tenant', render: (v, r) => <>{v}<span className="cell-sub">Unit {r.unit_code}</span></> },
        { key: 'amount', label: 'Amount', num: true, render: money },
        { key: 'method', label: 'Method', render: (v) => <Badge value={v} tone="b-indigo" /> },
        { key: 'reference_no', label: 'Reference' },
        { key: 'recorded_by', label: 'By' },
      ]}
      filters={[
        { name: 'method', label: 'Method', options: ['bank_transfer', 'online', 'card', 'cheque', 'cash'] },
        { name: 'tenant_id', label: 'Tenant', optionsFrom: 'tenants' },
      ]}
    />
  )
}

/* ==================================================================== Expenses */
export function Expenses() {
  return (
    <ResourcePage
      resource="expenses" pk="expense_id" title="Expenses" singular="Expense"
      description="Operating costs. Tax and total are STORED generated columns; a trigger rejects future dates."
      defaultSort="expense_date" defaultOrder="desc"
      columns={[
        { key: 'expense_date', label: 'Date', render: date, nowrap: true },
        { key: 'category_name', label: 'Category' },
        { key: 'description', label: 'Description', wrap: true },
        { key: 'vendor', label: 'Vendor' },
        { key: 'amount', label: 'Amount', num: true, render: money },
        { key: 'tax_amount', label: 'Tax', num: true, render: money },
        { key: 'total_amount', label: 'Total', num: true, render: (v) => <b>{money(v)}</b> },
      ]}
      filters={[{ name: 'category_id', label: 'Category', optionsFrom: 'expense-categories' }]}
      defaults={{ expense_date: today(), tax_rate: 0 }}
      fields={[
        { name: 'category_id', label: 'Category', type: 'select', optionsFrom: 'expense-categories', required: true },
        { name: 'expense_date', label: 'Date', type: 'date', required: true },
        { name: 'description', label: 'Description', required: true, full: true },
        { name: 'vendor', label: 'Vendor' },
        { name: 'amount', label: 'Amount (before tax)', type: 'number', step: '0.01', min: '0.01', required: true },
        { name: 'tax_rate', label: 'Tax rate %', type: 'number', step: '0.01', min: '0', max: '100' },
      ]}
    />
  )
}

/* =================================================================== Employees */
export function Employees() {
  return (
    <ResourcePage
      resource="employees" pk="employee_id" title="Employees" singular="Employee"
      description="Mall management staff. Salary and department changes are recorded in the audit log by a trigger."
      defaultSort="employee_code"
      columns={[
        { key: 'employee_code', label: 'Code', render: (v) => <b>{v}</b> },
        { key: 'full_name', label: 'Name' },
        { key: 'department_name', label: 'Department' },
        { key: 'job_title', label: 'Job title' },
        { key: 'monthly_salary', label: 'Salary / month', num: true, render: money },
        { key: 'hire_date', label: 'Hired', render: date, nowrap: true },
        { key: 'is_active', label: 'Active', render: yesNo },
      ]}
      filters={[
        { name: 'department_id', label: 'Department', optionsFrom: 'departments' },
        { name: 'is_active', label: 'Active', options: [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }] },
      ]}
      defaults={{ hire_date: today(), is_active: true }}
      fields={[
        { name: 'employee_code', label: 'Employee code', required: true, placeholder: 'EMP022' },
        { name: 'full_name', label: 'Full name', required: true },
        { name: 'department_id', label: 'Department', type: 'select', optionsFrom: 'departments', required: true },
        { name: 'job_title', label: 'Job title', required: true },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Phone', required: true },
        { name: 'monthly_salary', label: 'Monthly salary', type: 'number', step: '0.01', min: '0', required: true },
        { name: 'hire_date', label: 'Hire date', type: 'date', required: true },
        { name: 'is_active', label: 'Status', type: 'checkbox', checkboxLabel: 'Currently employed' },
      ]}
    />
  )
}

/* ================================================================= Maintenance */
export function Maintenance() {
  const fields = [
    { name: 'title', label: 'Title', required: true, full: true },
    { name: 'shop_id', label: 'Location', type: 'select', optionsFrom: 'shops', placeholder: 'Common area' },
    { name: 'assigned_to', label: 'Assigned to', type: 'select', optionsFrom: 'employees', placeholder: 'Unassigned' },
    { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'critical'], required: true },
    { name: 'status', label: 'Status', type: 'select', options: ['open', 'in_progress', 'resolved', 'closed'], required: true,
      help: 'resolved_at is set automatically by a trigger' },
    { name: 'cost', label: 'Cost', type: 'number', step: '0.01', min: '0' },
    { name: 'description', label: 'Description', type: 'textarea', full: true },
  ]
  return (
    <ResourcePage
      resource="maintenance" pk="request_id" title="Maintenance" singular="Request"
      description="Repair and service tickets for shops and common areas. Staff can log and update tickets."
      defaultSort="reported_at" defaultOrder="desc"
      canCreate={['admin', 'manager', 'staff']} canEdit={['admin', 'manager', 'staff']}
      columns={[
        { key: 'request_id', label: '#', render: (v) => <span className="muted">#{v}</span> },
        { key: 'title', label: 'Title', wrap: true, render: (v) => <b>{v}</b> },
        { key: 'location', label: 'Location' },
        { key: 'priority', label: 'Priority', sortKey: 'priority_rank', render: (v) => <Badge value={v} /> },
        { key: 'status', label: 'Status', render: (v) => <Badge value={v} /> },
        { key: 'assigned_name', label: 'Assigned to' },
        { key: 'reported_at', label: 'Reported', render: datetime, nowrap: true },
        { key: 'resolved_at', label: 'Resolved', render: datetime, nowrap: true },
        { key: 'cost', label: 'Cost', num: true, render: money },
      ]}
      filters={[
        { name: 'status', label: 'Status', options: ['open', 'in_progress', 'resolved', 'closed'] },
        { name: 'priority', label: 'Priority', options: ['low', 'medium', 'high', 'critical'] },
      ]}
      defaults={{ priority: 'medium', status: 'open', cost: 0 }}
      fields={fields}
    />
  )
}
