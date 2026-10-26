import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { autoFormat, label } from '../format'
import Icon from './Icons'

/* ------------------------------------------------------------------ Toasts */
const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const notify = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500)
  }, [])
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
export const useToast = () => useContext(ToastContext)

/* ------------------------------------------------------------------ Basics */
export function Spinner({ text = 'Loading…' }) {
  return <div className="loading"><div className="spinner" />{text}</div>
}

export function ErrorBox({ error }) {
  if (!error) return null
  return <div className="alert alert-error">{error.message || String(error)}</div>
}

const BADGE_TONES = {
  active: 'b-green', paid: 'b-green', occupied: 'b-indigo', resolved: 'b-green', closed: 'b-gray',
  vacant: 'b-blue', partially_paid: 'b-amber', unpaid: 'b-red', void: 'b-gray', terminated: 'b-gray',
  expired: 'b-gray', under_maintenance: 'b-amber', open: 'b-red', in_progress: 'b-amber',
  low: 'b-gray', medium: 'b-blue', high: 'b-amber', critical: 'b-red',
  admin: 'b-indigo', manager: 'b-blue', staff: 'b-gray',
  INSERT: 'b-green', UPDATE: 'b-amber', DELETE: 'b-red', yes: 'b-green', no: 'b-gray',
}
export function Badge({ value, tone }) {
  if (value === null || value === undefined) return <span className="muted">—</span>
  return <span className={`badge ${tone || BADGE_TONES[value] || 'b-gray'}`}>{label(value)}</span>
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmText = 'Confirm', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={run}>
        {busy ? 'Working…' : confirmText}
      </button>
    </>}>
      <div className="stack">
        <div>{message}</div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  )
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.key} className={`tab ${active === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------- SQL highlighting */
const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|AS|ON|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|VIEW|OR|REPLACE|PROCEDURE|FUNCTION|TRIGGER|EVENT|BEGIN|DECLARE|IF|ELSEIF|RETURN|RETURNS|CALL|WITH|RECURSIVE|OVER|PARTITION|ROWS|BETWEEN|UNBOUNDED|PRECEDING|CURRENT|ROW|EXISTS|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|CHECK|CONSTRAINT|DEFAULT|INDEX|START|TRANSACTION|COMMIT|ROLLBACK|SIGNAL|SQLSTATE|RESIGNAL|HANDLER|FOR|EACH|BEFORE|AFTER|NEW|OLD|LIKE|DESC|ASC|COALESCE|SUM|COUNT|AVG|MIN|MAX|ROUND|DATE_FORMAT|CURDATE|NOW|DATEDIFF|EXIT|SQLEXCEPTION|LOOP|WHILE|DO|READS|MODIFIES|SQL|DATA|DETERMINISTIC|SECURITY|DEFINER|INVOKER|GENERATED|ALWAYS|STORED|VIRTUAL|ENUM|VARCHAR|INT|DECIMAL|DATE|DATETIME|TIMESTAMP|TEXT|JSON|TINYINT|SMALLINT|BIGINT|UNSIGNED|AUTO_INCREMENT|CASCADE|RESTRICT|EXPLAIN|SHOW|DESCRIBE|UPDATE)\b/gi

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function highlightSql(sql) {
  const tokens = []
  const re = /(--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)/g
  let last = 0
  let m
  while ((m = re.exec(sql))) {
    tokens.push(escapeHtml(sql.slice(last, m.index)).replace(SQL_KEYWORDS, '<span class="kw">$&</span>'))
    if (m[1]) tokens.push(`<span class="cmt">${escapeHtml(m[1])}</span>`)
    else if (m[2]) tokens.push(`<span class="str">${escapeHtml(m[2])}</span>`)
    else tokens.push(`<span class="num">${m[3]}</span>`)
    last = re.lastIndex
  }
  tokens.push(escapeHtml(sql.slice(last)).replace(SQL_KEYWORDS, '<span class="kw">$&</span>'))
  return tokens.join('')
}

export function CodeBlock({ code, style }) {
  return <pre className="code" style={style} dangerouslySetInnerHTML={{ __html: highlightSql(code || '') }} />
}

/* --------------------------------------------------------------- DataTable */
export function DataTable({ columns, rows, sort, order, onSort, onRowClick, actions, loading, empty = 'No records found', compact }) {
  return (
    <div className="table-wrap">
      <table className={`table ${compact ? 'compact' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => {
              const sortable = onSort && c.sortable !== false
              const arrow = sort === (c.sortKey || c.key) ? (order === 'desc' ? ' ↓' : ' ↑') : ''
              return (
                <th key={c.key} className={`${sortable ? 'sortable' : ''} ${c.num ? 'num' : ''}`}
                  onClick={sortable ? () => onSort(c.sortKey || c.key) : undefined}>
                  {c.label}{arrow}
                </th>
              )
            })}
            {actions && <th className="actions" />}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={columns.length + (actions ? 1 : 0)}><Spinner /></td></tr>
          )}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={columns.length + (actions ? 1 : 0)} className="empty">{empty}</td></tr>
          )}
          {!loading && rows.map((row, i) => (
            <tr key={row.id ?? i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : c.wrap ? 'wrap' : ''}>
                  {c.render ? c.render(row[c.key], row) : row[c.key] ?? <span className="muted">—</span>}
                </td>
              ))}
              {actions && <td className="actions" onClick={(e) => e.stopPropagation()}>{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Table for arbitrary SQL results (reports, console, browser)
export function ResultTable({ columns, rows, maxHeight = 520 }) {
  if (!columns?.length) return <div className="empty">No rows returned</div>
  return (
    <div className="table-wrap" style={{ maxHeight, overflowY: 'auto' }}>
      <table className="table compact">
        <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="empty">No rows returned</td></tr>}
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>{autoFormat(c, r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="pagination">
      <span>{from}–{to} of {total}</span>
      <div className="row">
        {onPageSize && (
          <select className="input sm" style={{ width: 90 }} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- Forms */
const optionCache = {}

export function useOptions(resource) {
  const [options, setOptions] = useState(optionCache[resource] || [])
  useEffect(() => {
    if (!resource) return
    let alive = true
    api(`/${resource}/options`).then((o) => {
      optionCache[resource] = o
      if (alive) setOptions(o)
    }).catch(() => {})
    return () => { alive = false }
  }, [resource])
  return options
}

export const clearOptionCache = (resource) => { delete optionCache[resource] }

function SelectField({ field, value, onChange }) {
  const remote = useOptions(field.optionsFrom)
  const options = field.options
    ? field.options.map((o) => (typeof o === 'string' ? { value: o, label: label(o) } : o))
    : remote
  return (
    <select className="input" value={value ?? ''} required={field.required}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
      <option value="">{field.placeholder || (field.required ? 'Select…' : '— None —')}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function FormField({ field, value, onChange }) {
  let input
  if (field.type === 'select') input = <SelectField field={field} value={value} onChange={onChange} />
  else if (field.type === 'textarea')
    input = <textarea className="input" value={value ?? ''} required={field.required} placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)} />
  else if (field.type === 'checkbox')
    input = <label className="checkbox"><input type="checkbox" checked={!!Number(value) || value === true}
      onChange={(e) => onChange(e.target.checked)} /> {field.checkboxLabel || 'Yes'}</label>
  else
    input = <input className="input" type={field.type || 'text'} value={value ?? ''} required={field.required}
      step={field.step} min={field.min} max={field.max} placeholder={field.placeholder}
      onChange={(e) => onChange(e.target.value)} />
  return (
    <div className={`field ${field.full ? 'full' : ''}`}>
      <label>{field.label}{field.required && <span className="req">*</span>}</label>
      {input}
      {field.help && <span className="help">{field.help}</span>}
    </div>
  )
}

export function FormGrid({ fields, values, onChange }) {
  return (
    <div className="form-grid">
      {fields.map((f) => (
        <FormField key={f.name} field={f} value={values[f.name]} onChange={(v) => onChange({ ...values, [f.name]: v })} />
      ))}
    </div>
  )
}

// Convert form strings into the JSON types the API expects
export function coerce(fields, values) {
  const out = {}
  fields.forEach((f) => {
    let v = values[f.name]
    if (v === undefined) return
    if (v === '' || v === null) v = null
    else if (f.type === 'number' || f.numeric) v = Number(v)
    else if (f.type === 'checkbox') v = !!(v === true || Number(v))
    else if (f.type === 'select' && f.numeric !== false && /_id$|^assigned_to$/.test(f.name)) v = Number(v)
    out[f.name] = v
  })
  return out
}

export function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export function useApi(path, params, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const key = useMemo(() => JSON.stringify(params || {}), [params])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!path) return
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    api(path, { params: params || undefined })
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, tick, ...deps])
  return { ...state, reload: () => setTick((t) => t + 1) }
}
