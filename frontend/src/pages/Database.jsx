// Database administration: everything a DBMS course asks to "show" about the
// database (schema, ER diagram, constraints, programmable objects, a query
// console, the audit trail, scripts and backups) in one place.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, download } from '../api'
import { useAuth } from '../auth'
import ErDiagram from '../components/ErDiagram'
import Icon from '../components/Icons'
import {
  Badge, CodeBlock, DataTable, ErrorBox, Pagination, ResultTable, Spinner, Tabs, useApi, useToast,
} from '../components/ui'
import { bytes, datetime, label, num } from '../format'

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'er', label: 'ER diagram' },
  { key: 'schema', label: 'Schema explorer' },
  { key: 'objects', label: 'Views & routines' },
  { key: 'console', label: 'SQL console' },
  { key: 'audit', label: 'Audit log' },
  { key: 'scripts', label: 'Scripts & backup' },
]

export default function Database() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'overview'
  const go = useCallback((t, extra = {}) => setParams({ tab: t, ...extra }), [setParams])
  return (
    <div>
      <Tabs tabs={TABS} active={tab} onChange={(t) => go(t)} />
      {tab === 'overview' && <Overview go={go} />}
      {tab === 'er' && <ErTab go={go} />}
      {tab === 'schema' && <Schema initial={params.get('table')} go={go} />}
      {tab === 'objects' && <Objects />}
      {tab === 'console' && <Console initial={params.get('sql')} />}
      {tab === 'audit' && <Audit />}
      {tab === 'scripts' && <Scripts />}
    </div>
  )
}

/* -------------------------------------------------------------- Overview */
function Overview({ go }) {
  const { data, loading, error } = useApi('/admin/overview')
  if (loading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  const s = data.server
  const base = data.tables.filter((t) => t.type === 'BASE TABLE')
  const views = data.tables.filter((t) => t.type === 'VIEW')
  const c = data.constraint_counts
  const stats = [
    ['Tables', base.length], ['Views', views.length],
    ['Procedures', data.object_counts.PROCEDURE || 0], ['Functions', data.object_counts.FUNCTION || 0],
    ['Triggers', data.object_counts.TRIGGER || 0], ['Events', data.object_counts.EVENT || 0],
    ['Foreign keys', c['FOREIGN KEY'] || 0], ['Check constraints', c.CHECK || 0],
    ['Unique keys', c.UNIQUE || 0], ['Indexes', data.index_count],
    ['Total rows', num(base.reduce((a, t) => a + t.rows, 0))], ['Size on disk', bytes(data.total_bytes)],
  ]
  return (
    <div className="stack">
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {stats.map(([k, v]) => (
          <div className="card" key={k} style={{ padding: '12px 14px' }}>
            <div className="kpi-label">{k}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-3">
        <div className="card">
          <div className="card-head"><h3>Server</h3><Badge value="connected" tone="b-green" /></div>
          <div className="card-body">
            <dl className="kv">
              <dt>MySQL version</dt><dd>{s.version}</dd>
              <dt>Database</dt><dd className="mono">{s.database_name}</dd>
              <dt>Storage engine</dt><dd>{s.storage_engine}</dd>
              <dt>Character set</dt><dd>{s.charset}</dd>
              <dt>Collation</dt><dd>{s.collation}</dd>
              <dt>Isolation level</dt><dd>{s.isolation_level}</dd>
              <dt>Event scheduler</dt><dd><Badge value={s.event_scheduler} tone={s.event_scheduler === 'ON' ? 'b-green' : 'b-amber'} /></dd>
              <dt>Server time</dt><dd>{datetime(s.server_time)}</dd>
            </dl>
          </div>
        </div>
        <div className="card span-2">
          <div className="card-head"><h3>Tables</h3><span className="text-2">Exact row counts · click a table to inspect it</span></div>
          <DataTable compact rows={base} onRowClick={(t) => go('schema', { table: t.name })} columns={[
            { key: 'name', label: 'Table', render: (v) => <b className="mono">{v}</b> },
            { key: 'rows', label: 'Rows', num: true, render: num },
            { key: 'data_bytes', label: 'Data', num: true, render: bytes },
            { key: 'index_bytes', label: 'Indexes', num: true, render: bytes },
            { key: 'comment', label: 'Description', wrap: true, render: (v) => <span className="text-2">{v}</span> },
          ]} />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- ER diagram */
function ErTab({ go }) {
  const { data, loading, error } = useApi('/admin/er-diagram')
  if (loading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Entity-relationship diagram</h3>
          <div className="sub">
            Drawn live from <code>INFORMATION_SCHEMA</code>: {data.tables.length} tables, {data.relations.length} foreign keys.
            🔑 primary key · ↗ foreign key · * NOT NULL · <i>italic</i> = generated column. Crow's foot = "many" side.
            Hover a table to highlight its relationships, click it to open it.
          </div>
        </div>
      </div>
      <ErDiagram data={data} onSelect={(t) => go('schema', { table: t })} />
    </div>
  )
}

/* -------------------------------------------------------- Schema explorer */
function Schema({ initial, go }) {
  const { data: overview } = useApi('/admin/overview')
  const name = initial || 'shops'
  const [sub, setSub] = useState('structure')
  const { data, loading, error } = useApi(`/admin/tables/${name}`)
  const tables = overview?.tables || []

  return (
    <div className="grid" style={{ gridTemplateColumns: '230px minmax(0, 1fr)', alignItems: 'start' }}>
      <div className="card side-list" style={{ padding: 8 }}>
        <div className="group">Tables</div>
        {tables.filter((t) => t.type === 'BASE TABLE').map((t) => (
          <button key={t.name} className={name === t.name ? 'active' : ''} onClick={() => go('schema', { table: t.name })}>
            <span className="mono">{t.name}</span><span className="count">{num(t.rows)}</span>
          </button>
        ))}
        <div className="group">Views</div>
        {tables.filter((t) => t.type === 'VIEW').map((t) => (
          <button key={t.name} className={name === t.name ? 'active' : ''} onClick={() => go('schema', { table: t.name })}>
            <span className="mono">{t.name}</span>
          </button>
        ))}
      </div>
      <div className="stack">
        {loading && <Spinner />}
        <ErrorBox error={error} />
        {data && (
          <>
            <div className="page-head" style={{ marginBottom: 0 }}>
              <div>
                <h2 className="mono">{data.name}</h2>
                <p>{data.type === 'VIEW' ? 'View' : `Base table · ${num(data.row_count)} rows`}</p>
              </div>
              <div className="pill-tabs">
                {['structure', 'data', 'ddl'].map((k) => (
                  <button key={k} className={sub === k ? 'active' : ''} onClick={() => setSub(k)}>
                    {k === 'ddl' ? 'DDL' : label(k)}
                  </button>
                ))}
              </div>
            </div>
            {sub === 'structure' && <Structure data={data} go={go} />}
            {sub === 'data' && <Rows name={data.name} />}
            {sub === 'ddl' && <CodeBlock code={data.ddl || '-- definition not available'} style={{ maxHeight: 600 }} />}
          </>
        )}
      </div>
    </div>
  )
}

function Structure({ data, go }) {
  const keyBadge = (k) => ({ PRI: <Badge value="PK" tone="b-indigo" />, UNI: <Badge value="UNIQUE" tone="b-blue" />, MUL: <Badge value="INDEX" tone="b-gray" /> }[k] || null)
  return (
    <>
      <div className="card">
        <div className="card-head"><h3>Columns ({data.columns.length})</h3></div>
        <DataTable compact rows={data.columns} columns={[
          { key: 'name', label: 'Column', render: (v) => <b className="mono">{v}</b> },
          { key: 'type', label: 'Type', render: (v) => <span className="mono" style={{ fontSize: 12 }}>{v}</span> },
          { key: 'nullable', label: 'Null', render: (v) => (v === 'YES' ? 'NULL' : <b>NOT NULL</b>) },
          { key: 'key', label: 'Key', render: keyBadge },
          { key: 'default_value', label: 'Default', render: (v) => (v === null ? <span className="muted">—</span> : <span className="mono" style={{ fontSize: 12 }}>{v}</span>) },
          { key: 'extra', label: 'Extra', wrap: true, render: (v, r) => (
            <span className="mono" style={{ fontSize: 12 }}>{r.generated_as ? `AS (${r.generated_as}) ${v.replace(/ ?(STORED|VIRTUAL) GENERATED/, ' $1')}` : v}</span>
          ) },
          { key: 'comment', label: 'Comment', wrap: true, render: (v) => <span className="text-2">{v}</span> },
        ]} />
      </div>
      {data.type === 'BASE TABLE' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h3>Indexes ({data.indexes.length})</h3></div>
            <DataTable compact rows={data.indexes} columns={[
              { key: 'name', label: 'Name', render: (v) => <span className="mono">{v}</span> },
              { key: 'columns', label: 'Columns', render: (v) => <span className="mono">{v}</span> },
              { key: 'is_unique', label: 'Unique', render: (v) => (Number(v) ? <Badge value="unique" tone="b-blue" /> : '') },
              { key: 'index_type', label: 'Type' },
            ]} />
          </div>
          <div className="card">
            <div className="card-head"><h3>Check constraints ({data.checks.length})</h3></div>
            <DataTable compact rows={data.checks} empty="No CHECK constraints" columns={[
              { key: 'name', label: 'Name', render: (v) => <span className="mono">{v}</span> },
              { key: 'clause', label: 'Condition', wrap: true, render: (v) => <span className="mono" style={{ fontSize: 12 }}>{v}</span> },
            ]} />
          </div>
          <div className="card">
            <div className="card-head"><h3>Foreign keys ({data.foreign_keys.length})</h3></div>
            <DataTable compact rows={data.foreign_keys} empty="This table references no other table" columns={[
              { key: 'column_name', label: 'Column', render: (v) => <span className="mono">{v}</span> },
              { key: 'references_table', label: 'References', render: (v, r) => (
                <button className="link-btn mono" onClick={() => go('schema', { table: v })}>{v}({r.references_column})</button>
              ) },
              { key: 'on_delete', label: 'On delete', render: (v) => <Badge value={v} tone={v === 'CASCADE' ? 'b-amber' : 'b-gray'} /> },
              { key: 'on_update', label: 'On update' },
            ]} />
          </div>
          <div className="card">
            <div className="card-head"><h3>Referenced by ({data.referenced_by.length})</h3></div>
            <DataTable compact rows={data.referenced_by} empty="No table references this one" columns={[
              { key: 'table_name', label: 'Table', render: (v, r) => (
                <button className="link-btn mono" onClick={() => go('schema', { table: v })}>{v}.{r.column_name}</button>
              ) },
              { key: 'name', label: 'Constraint', render: (v) => <span className="mono" style={{ fontSize: 12 }}>{v}</span> },
              { key: 'on_delete', label: 'On delete', render: (v) => <Badge value={v} tone={v === 'CASCADE' ? 'b-amber' : 'b-gray'} /> },
            ]} />
          </div>
          <div className="card span-2" style={{ gridColumn: '1 / -1' }}>
            <div className="card-head"><h3>Triggers ({data.triggers.length})</h3></div>
            {data.triggers.length === 0 ? <div className="empty">No triggers on this table</div> : (
              <div className="card-body stack">
                {data.triggers.map((t) => (
                  <details key={t.object_name}>
                    <summary><b className="mono">{t.object_name}</b> <span className="text-2">· {t.details}</span></summary>
                    <CodeBlock code={t.definition} style={{ marginTop: 8, maxHeight: 360 }} />
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Rows({ name }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  useEffect(() => { setPage(1) }, [name])
  const { data, loading, error } = useApi(`/admin/tables/${name}/rows`, { page, page_size: pageSize })
  return (
    <div className="card">
      <div className="card-head">
        <h3>Data</h3>
        <span className="text-2">Read through the <code>mall_readonly</code> account (SELECT privilege only)</span>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <ResultTable columns={data.columns} rows={data.rows} maxHeight={560} />
          <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
        </>
      )}
    </div>
  )
}

/* ---------------------------------------------------- Programmable objects */
const OBJ_TYPES = ['VIEW', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'EVENT']

function Objects() {
  const { data, loading, error } = useApi('/admin/objects')
  const [type, setType] = useState('PROCEDURE')
  const [selected, setSelected] = useState(null)
  const list = useMemo(() => (data || []).filter((o) => o.object_type === type), [data, type])
  useEffect(() => { setSelected(list[0] || null) }, [list])
  if (loading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  return (
    <div className="stack">
      <div className="pill-tabs">
        {OBJ_TYPES.map((t) => (
          <button key={t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>
            {label(t.toLowerCase())}s <span className="count">{data.filter((o) => o.object_type === t).length}</span>
          </button>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '300px minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="card side-list" style={{ padding: 8, maxHeight: 640, overflowY: 'auto' }}>
          {list.map((o) => (
            <button key={o.object_name} className={selected?.object_name === o.object_name ? 'active' : ''} onClick={() => setSelected(o)}>
              <span>
                <span className="mono" style={{ display: 'block' }}>{o.object_name}</span>
                <small className="text-2">{o.related_table ? `${o.related_table} · ` : ''}{o.details}</small>
              </span>
            </button>
          ))}
        </div>
        {selected && (
          <div className="card">
            <div className="card-head">
              <div>
                <h3 className="mono">{selected.object_name}</h3>
                <div className="sub">{label(selected.object_type.toLowerCase())}{selected.related_table ? ` on ${selected.related_table}` : ''} · {selected.details}</div>
              </div>
            </div>
            <div className="card-body"><CodeBlock code={selected.definition} style={{ maxHeight: 560 }} /></div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- SQL console */
const EXAMPLES = [
  { title: 'Occupancy by floor (view)', sql: 'SELECT * FROM v_floor_occupancy ORDER BY level_number;' },
  { title: 'Tenants with overdue rent', sql: 'SELECT business_name, outstanding, overdue_amount\nFROM v_tenant_balances\nWHERE overdue_amount > 0\nORDER BY overdue_amount DESC;' },
  { title: 'JOIN + GROUP BY: rent by category', sql: "SELECT c.name AS category, COUNT(l.lease_id) AS active_leases,\n       SUM(l.monthly_rent) AS monthly_rent\nFROM shop_categories c\nLEFT JOIN shops s  ON s.category_id = c.category_id\nLEFT JOIN leases l ON l.shop_id = s.shop_id AND l.status = 'active'\nGROUP BY c.category_id, c.name\nHAVING active_leases > 0\nORDER BY monthly_rent DESC;" },
  { title: 'Window function: rank tenants', sql: 'SELECT business_name, total_paid,\n       RANK() OVER (ORDER BY total_paid DESC) AS payment_rank,\n       ROUND(100 * total_paid / SUM(total_paid) OVER (), 2) AS pct_of_total\nFROM v_tenant_balances;' },
  { title: 'CTE: month-over-month income', sql: 'WITH m AS (\n  SELECT period, income FROM v_profit_and_loss\n)\nSELECT period, income,\n       income - LAG(income) OVER (ORDER BY period) AS change_vs_prev\nFROM m ORDER BY period;' },
  { title: 'Subquery: shops never leased', sql: 'SELECT unit_code, status, base_rent\nFROM shops s\nWHERE NOT EXISTS (SELECT 1 FROM leases l WHERE l.shop_id = s.shop_id);' },
  { title: 'Stored function in a query', sql: "SELECT invoice_no, total_amount,\n       fn_invoice_paid(invoice_id)    AS paid,\n       fn_invoice_balance(invoice_id) AS balance\nFROM invoices WHERE status = 'partially_paid';" },
  { title: 'EXPLAIN: is an index used?', sql: "EXPLAIN SELECT * FROM invoices WHERE status = 'unpaid' AND due_date < CURDATE();" },
  { title: 'Indexes of a table', sql: 'SHOW INDEX FROM invoices;' },
]

function Console({ initial }) {
  const [sql, setSql] = useState(initial || EXAMPLES[0].sql)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState(() => JSON.parse(localStorage.getItem('mms_sql_history') || '[]'))
  const ref = useRef(null)
  const notify = useToast()

  const run = async () => {
    if (!sql.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await api('/admin/sql', { method: 'POST', body: { sql } })
      setResult(r)
      const h = [sql, ...history.filter((x) => x !== sql)].slice(0, 15)
      setHistory(h)
      localStorage.setItem('mms_sql_history', JSON.stringify(h))
    } catch (e) {
      setError(e)
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    if (!result) return
    const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
    const csv = [result.columns.join(','), ...result.rows.map((r) => result.columns.map((c) => esc(r[c])).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'query_result.csv'
    a.click()
    URL.revokeObjectURL(a.href)
    notify('CSV downloaded')
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 280px', alignItems: 'start' }}>
      <div className="stack">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Query</h3>
              <div className="sub">Read-only: runs as <code>mall_readonly</code> in a READ ONLY transaction, one statement, 5 s limit, max 500 rows.</div>
            </div>
            <div className="row">
              <span className="text-2" style={{ fontSize: 12 }}>Ctrl + Enter</span>
              <button className="btn btn-primary" onClick={run} disabled={busy}><Icon name="play" /> {busy ? 'Running…' : 'Run'}</button>
            </div>
          </div>
          <textarea ref={ref} className="sql-editor" spellCheck={false} value={sql} onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() }
              if (e.key === 'Tab') {
                e.preventDefault()
                const { selectionStart: s0, selectionEnd: s1 } = e.target
                const v = sql.slice(0, s0) + '  ' + sql.slice(s1)
                setSql(v)
                requestAnimationFrame(() => { ref.current.selectionStart = ref.current.selectionEnd = s0 + 2 })
              }
            }} />
        </div>
        <ErrorBox error={error} />
        {result && (
          <div className="card">
            <div className="card-head">
              <h3>Result</h3>
              <div className="row">
                <span className="text-2">{result.row_count} row(s){result.truncated ? ' (truncated)' : ''} · {result.elapsed_ms} ms</span>
                <button className="btn btn-sm" onClick={exportCsv} disabled={!result.columns.length}><Icon name="download" /> CSV</button>
              </div>
            </div>
            <ResultTable columns={result.columns} rows={result.rows} />
          </div>
        )}
      </div>
      <div className="stack">
        <div className="card side-list" style={{ padding: 8 }}>
          <div className="group">Examples</div>
          {EXAMPLES.map((e) => <button key={e.title} onClick={() => setSql(e.sql)}>{e.title}</button>)}
        </div>
        {history.length > 0 && (
          <div className="card side-list" style={{ padding: 8 }}>
            <div className="group">History</div>
            {history.map((h, i) => (
              <button key={i} onClick={() => setSql(h)} title={h}>
                <span className="mono" style={{ fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.replace(/\s+/g, ' ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- Audit log */
function Diff({ oldData, newData }) {
  const keys = [...new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})])]
  const show = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  return (
    <table className="table compact diff-table">
      <thead><tr><th>Field</th><th>Old</th><th>New</th></tr></thead>
      <tbody>
        {keys.map((k) => {
          const o = oldData?.[k]
          const n = newData?.[k]
          const changed = oldData && newData && show(o) !== show(n)
          return (
            <tr key={k}>
              <td className="mono">{k}</td>
              <td className={changed || (!newData && oldData) ? 'diff-old' : ''}>{oldData ? show(o) : ''}</td>
              <td className={changed || (!oldData && newData) ? 'diff-new' : ''}>{newData ? show(n) : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Audit() {
  const [filters, setFilters] = useState({ table_name: '', action: '' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [open, setOpen] = useState(null)
  const params = { page, page_size: pageSize, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }
  const { data, loading, error } = useApi('/admin/audit', params)
  const tables = ['shops', 'tenants', 'leases', 'invoices', 'payments', 'employees', 'expenses', 'maintenance_requests', 'app_users']
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Audit trail</h3>
          <div className="sub">Rows written by <code>AFTER INSERT / UPDATE / DELETE</code> triggers using <code>JSON_OBJECT()</code>. Click a row to see the change.</div>
        </div>
        <div className="row">
          <select className="input" value={filters.table_name} onChange={(e) => { setFilters({ ...filters, table_name: e.target.value }); setPage(1) }}>
            <option value="">All tables</option>
            {tables.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select className="input" value={filters.action} onChange={(e) => { setFilters({ ...filters, action: e.target.value }); setPage(1) }}>
            <option value="">All actions</option>
            {['INSERT', 'UPDATE', 'DELETE'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <ErrorBox error={error} />
      <DataTable rows={data?.items || []} loading={loading} empty="No audit entries yet. Make a change anywhere in the app and it will appear here."
        onRowClick={(r) => setOpen(open === r.audit_id ? null : r.audit_id)}
        columns={[
          { key: 'audit_id', label: '#', render: (v) => <span className="muted">#{v}</span> },
          { key: 'changed_at', label: 'When', render: datetime, nowrap: true },
          { key: 'action', label: 'Action', render: (v) => <Badge value={v} tone={{ INSERT: 'b-green', UPDATE: 'b-blue', DELETE: 'b-red' }[v]} /> },
          { key: 'table_name', label: 'Table', render: (v) => <span className="mono">{v}</span> },
          { key: 'record_id', label: 'Record', num: true },
          { key: 'changed_by', label: 'By' },
          { key: 'new_data', label: 'Change', wrap: true, render: (v, r) => (open === r.audit_id
            ? <Diff oldData={r.old_data} newData={r.new_data} />
            : <span className="text-2">{summarise(r)}</span>) },
        ]} />
      {data && <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />}
    </div>
  )
}

function summarise(r) {
  if (r.action === 'UPDATE' && r.old_data && r.new_data) {
    const changed = Object.keys(r.new_data).filter((k) => JSON.stringify(r.old_data[k]) !== JSON.stringify(r.new_data[k]))
    return changed.length ? `Changed: ${changed.join(', ')}` : 'No field changes'
  }
  return `${Object.keys(r.new_data || r.old_data || {}).length} fields`
}

/* ------------------------------------------------------ Scripts & backup */
function Scripts() {
  const { hasRole } = useAuth()
  const notify = useToast()
  const { data, loading, error } = useApi('/admin/scripts')
  const [selected, setSelected] = useState(null)
  const [content, setContent] = useState('')
  useEffect(() => { if (data?.length && !selected) setSelected(data[0].name) }, [data, selected])
  useEffect(() => {
    if (!selected) return
    api(`/admin/scripts/${selected}`).then(setContent).catch((e) => setContent(`-- ${e.message}`))
  }, [selected])
  if (loading) return <Spinner />
  if (error) return <ErrorBox error={error} />
  return (
    <div className="stack">
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3><Icon name="download" /> Backup</h3></div>
          <div className="card-body stack">
            <p className="text-2" style={{ margin: 0 }}>
              Downloads a <b>data-only</b> SQL dump (INSERT statements in foreign-key order) generated by the API.
              For a full backup including routines, triggers and events use <code>python manage.py backup</code>, which
              runs <code>mysqldump --routines --triggers --events</code>.
            </p>
            <div>
              <button className="btn btn-primary" disabled={!hasRole('admin')}
                onClick={() => download('/admin/backup', null, 'mall_db_data.sql').then(() => notify('Backup downloaded')).catch((e) => notify(e.message, 'error'))}>
                <Icon name="download" /> Download data backup
              </button>
              {!hasRole('admin') && <span className="text-2" style={{ marginLeft: 10 }}>Admin only</span>}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3><Icon name="refresh" /> Restore</h3></div>
          <div className="card-body">
            <p className="text-2" style={{ marginTop: 0 }}>
              Restoring replaces data, so it is done from the command line with an administrator account, not from the web app:
            </p>
            <CodeBlock code={'# rebuild schema, then load a data dump\npython manage.py setup-db --no-seed\nmysql -u root -p mall_db < mall_db_data.sql\n\n# or restore a full mysqldump backup\npython manage.py restore backups/mall_db_YYYYMMDD_HHMMSS.sql.gz'} />
          </div>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '240px minmax(0, 1fr)', alignItems: 'start' }}>
        <div className="card side-list" style={{ padding: 8 }}>
          <div className="group">database/</div>
          {data.map((f) => (
            <button key={f.name} className={selected === f.name ? 'active' : ''} onClick={() => setSelected(f.name)}>
              <span className="mono">{f.name}</span><span className="count">{bytes(f.bytes)}</span>
            </button>
          ))}
        </div>
        <div className="card">
          <div className="card-head"><h3 className="mono">{selected}</h3></div>
          <div className="card-body"><CodeBlock code={content} style={{ maxHeight: 640 }} /></div>
        </div>
      </div>
    </div>
  )
}
