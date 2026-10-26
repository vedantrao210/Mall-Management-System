import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import Icon from '../components/Icons'
import { Badge, ErrorBox, Spinner, useApi } from '../components/ui'
import { compact, date, label, money, num } from '../format'

export const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#64748b', '#ec4899']
const STATUS_COLORS = { paid: '#10b981', partially_paid: '#f59e0b', unpaid: '#ef4444', void: '#94a3b8' }

function Kpi({ icon, tone, label: title, value, hint }) {
  return (
    <div className="card kpi">
      <div className={`kpi-icon tone-${tone}`}><Icon name={icon} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="kpi-label">{title}</div>
        <div className="kpi-value">{value}</div>
        {hint && <div className="kpi-hint">{hint}</div>}
      </div>
    </div>
  )
}

const tooltipMoney = (v) => money(v)

export default function Dashboard() {
  const { data, loading, error } = useApi('/dashboard')
  if (loading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const k = data.kpis

  return (
    <div className="stack">
      <div className="grid grid-4">
        <Kpi icon="shop" tone="primary" label="Occupancy" value={`${k.occupancy_pct}%`}
          hint={`${k.occupied_shops} of ${k.total_shops} units · ${k.vacant_shops} vacant`} />
        <Kpi icon="file" tone="info" label="Contracted rent / month" value={compact(k.contracted_rent)}
          hint={`${k.active_leases} active leases · ${k.tenants} tenants`} />
        <Kpi icon="cash" tone="success" label="Collected this month" value={compact(k.collected_this_month)}
          hint={`Expenses this month: ${compact(k.expenses_this_month)}`} />
        <Kpi icon="alert" tone="danger" label="Outstanding" value={compact(k.outstanding)}
          hint={`${k.overdue_invoices} overdue invoices · ${compact(k.overdue_amount)}`} />
      </div>

      <div className="grid grid-3">
        <div className="card span-2">
          <div className="card-head">
            <div><h3>Income vs expenses</h3><div className="sub">Last 12 months · view <code>v_profit_and_loss</code></div></div>
          </div>
          <div className="card-body chart-box" style={{ height: 300 }}>
            <ResponsiveContainer>
              <ComposedChart data={data.profit_and_loss}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={tooltipMoney} />
                <Legend />
                <Bar dataKey="income" name="Income" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Expenses" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                <Line dataKey="net_profit" name="Net" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3>Invoice status</h3><div className="sub">All invoices by value</div></div></div>
          <div className="card-body chart-box" style={{ height: 300 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data.invoice_status} dataKey="amount" nameKey="status" innerRadius={60} outerRadius={95} paddingAngle={2}>
                  {data.invoice_status.map((s) => <Cell key={s.status} fill={STATUS_COLORS[s.status] || '#94a3b8'} />)}
                </Pie>
                <Tooltip formatter={tooltipMoney} labelFormatter={label} />
                <Legend formatter={(v) => label(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><div><h3>Occupancy by floor</h3><div className="sub">View <code>v_floor_occupancy</code></div></div></div>
          <div className="card-body chart-box">
            <ResponsiveContainer>
              <BarChart data={data.floor_occupancy}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="floor_name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
                <Tooltip />
                <Legend />
                <Bar dataKey="occupied_units" name="Occupied" stackId="a" fill="#4f46e5" />
                <Bar dataKey="vacant_units" name="Vacant" stackId="a" fill="#93c5fd" />
                <Bar dataKey="maintenance_units" name="Maintenance" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div><h3>Expenses by category</h3><div className="sub">Last 12 months</div></div></div>
          <div className="card-body chart-box">
            <ResponsiveContainer>
              <BarChart data={data.expense_breakdown} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="category_name" tick={{ fontSize: 11 }} width={165} interval={0} />
                <Tooltip formatter={tooltipMoney} />
                <Bar dataKey="total" name="Total" radius={[0, 4, 4, 0]}>
                  {data.expense_breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <ListCard title="Highest outstanding balances" link="/tenants" items={data.top_debtors} empty="No outstanding balances"
          render={(t) => (<>
            <div><div className="title">{t.business_name}</div><div className="meta">Overdue {money(t.overdue_amount)}</div></div>
            <b>{money(t.outstanding)}</b>
          </>)} />
        <ListCard title="Leases expiring within 90 days" link="/leases" items={data.expiring_leases} empty="No leases expiring soon"
          render={(l) => (<>
            <div><div className="title">{l.business_name} · {l.unit_code}</div><div className="meta">Ends {date(l.end_date)}</div></div>
            <Badge value={`${l.days_remaining} days`} tone={l.days_remaining <= 30 ? 'b-red' : 'b-amber'} />
          </>)} />
        <ListCard title="Recent payments" link="/payments" items={data.recent_payments} empty="No payments yet"
          render={(p) => (<>
            <div><div className="title">{p.business_name}</div><div className="meta">{date(p.payment_date)} · {p.invoice_no} · {label(p.method)}</div></div>
            <b className="success-text">{money(p.amount)}</b>
          </>)} />
        <ListCard title={`Open maintenance (${k.open_tickets})`} link="/maintenance" items={data.open_maintenance} empty="No open tickets"
          render={(m) => (<>
            <div><div className="title">{m.title}</div><div className="meta">{m.location} · {m.assigned_to || 'Unassigned'} · {num(m.age_days)} d old</div></div>
            <Badge value={m.priority} />
          </>)} />
      </div>
    </div>
  )
}

function ListCard({ title, link, items, render, empty }) {
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3><Link to={link} className="btn btn-sm btn-ghost">View all</Link></div>
      {items.length === 0 ? <div className="empty">{empty}</div> : (
        <ul className="list">{items.map((it, i) => <li key={i}>{render(it)}</li>)}</ul>
      )}
    </div>
  )
}
