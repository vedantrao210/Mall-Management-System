import { useEffect, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, download } from '../api'
import Icon from '../components/Icons'
import { CodeBlock, ErrorBox, ResultTable, Spinner, useOptions, useToast } from '../components/ui'
import { compact, label, money } from '../format'
import { COLORS } from './Dashboard'

function ReportChart({ chart, rows }) {
  if (!chart || !rows.length) return null
  const Chart = chart.type === 'line' ? LineChart : BarChart
  return (
    <div className="card-body chart-box" style={{ height: 300 }}>
      <ResponsiveContainer>
        <Chart data={rows}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey={chart.x} tick={{ fontSize: 11 }} interval={0} angle={rows.length > 8 ? -25 : 0}
            textAnchor={rows.length > 8 ? 'end' : 'middle'} height={rows.length > 8 ? 70 : 30} />
          <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={60} />
          <Tooltip formatter={(v, n) => (/units/.test(n) ? v : money(v))} />
          <Legend formatter={label} />
          {chart.y.map((y, i) => chart.type === 'line'
            ? <Line key={y} dataKey={y} stroke={COLORS[i]} strokeWidth={2.5} />
            : <Bar key={y} dataKey={y} fill={COLORS[i]} stackId={chart.stacked ? 's' : undefined} radius={chart.stacked ? 0 : [4, 4, 0, 0]} />)}
        </Chart>
      </ResponsiveContainer>
    </div>
  )
}

export default function Reports() {
  const notify = useToast()
  const tenants = useOptions('tenants')
  const [catalogue, setCatalogue] = useState([])
  const [active, setActive] = useState('profit-and-loss')
  const [year, setYear] = useState(new Date().getFullYear())
  const [tenantId, setTenantId] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { api('/reports').then(setCatalogue).catch(setError) }, [])

  useEffect(() => {
    let path
    let params
    if (active === 'monthly-summary') { path = '/reports/monthly-summary'; params = { year } }
    else if (active === 'tenant-statement') {
      if (!tenantId) { setResult(null); return }
      path = `/reports/tenant-statement/${tenantId}`
    } else path = `/reports/${active}`
    setLoading(true)
    setError(null)
    api(path, { params })
      .then((r) => setResult(r))
      .catch(setError)
      .finally(() => setLoading(false))
  }, [active, year, tenantId])

  const meta = active === 'monthly-summary'
    ? { title: 'Monthly financial summary', description: 'Stored procedure using a recursive CTE to generate all 12 months, correlated subqueries for the figures and a window function for the cumulative total.', chart: { type: 'bar', x: 'period', y: ['collected', 'expenses'] } }
    : active === 'tenant-statement'
      ? { title: 'Tenant account statement', description: 'Stored procedure combining invoices and payments (UNION ALL) with a running balance computed by SUM() OVER (ORDER BY …).', chart: null }
      : catalogue.find((c) => c.key === active) || {}

  const exportCsv = () => {
    const path = active === 'monthly-summary' ? '/reports/monthly-summary'
      : active === 'tenant-statement' ? `/reports/tenant-statement/${tenantId}` : `/reports/${active}`
    download(path, { format: 'csv', ...(active === 'monthly-summary' ? { year } : {}) }).catch((e) => notify(e.message, 'error'))
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: '260px minmax(0, 1fr)', alignItems: 'start' }}>
      <div className="card side-list" style={{ padding: 8, position: 'sticky', top: 76 }}>
        <div className="group">Views</div>
        {catalogue.map((c) => (
          <button key={c.key} className={active === c.key ? 'active' : ''} onClick={() => setActive(c.key)}>{c.title}</button>
        ))}
        <div className="group">Stored procedures</div>
        <button className={active === 'monthly-summary' ? 'active' : ''} onClick={() => setActive('monthly-summary')}>Monthly summary</button>
        <button className={active === 'tenant-statement' ? 'active' : ''} onClick={() => setActive('tenant-statement')}>Tenant statement</button>
      </div>

      <div className="stack">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h2>{meta.title}</h2>
            <p>{meta.description}</p>
          </div>
          <div className="row">
            {active === 'monthly-summary' && (
              <select className="input" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => <option key={y}>{y}</option>)}
              </select>
            )}
            {active === 'tenant-statement' && (
              <select className="input" style={{ width: 240 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
                <option value="">Choose a tenant…</option>
                {tenants.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}
            <button className="btn" onClick={exportCsv} disabled={!result}><Icon name="download" /> Export CSV</button>
          </div>
        </div>
        <ErrorBox error={error} />
        {result?.sql && <CodeBlock code={result.sql} style={{ maxHeight: 140 }} />}
        {loading && <Spinner />}
        {!loading && result && (
          <>
            {meta.chart && <div className="card"><ReportChart chart={meta.chart} rows={result.rows} /></div>}
            <div className="card">
              <div className="card-head"><h3>Result</h3><span className="text-2">{result.rows.length} rows</span></div>
              <ResultTable columns={result.columns} rows={result.rows} />
            </div>
          </>
        )}
        {!loading && !result && active === 'tenant-statement' && <div className="card empty">Choose a tenant to see the statement.</div>}
      </div>
    </div>
  )
}
