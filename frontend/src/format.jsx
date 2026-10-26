// Display helpers. Amounts are shown without a currency symbol so the project
// stays currency-neutral; change `CURRENCY` to e.g. '$ ' if you need one.
export const CURRENCY = ''

const moneyFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const numFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

const isEmpty = (v) => v === null || v === undefined || v === ''

export const money = (v) => (isEmpty(v) ? '—' : CURRENCY + moneyFmt.format(Number(v)))
export const num = (v) => (isEmpty(v) ? '—' : numFmt.format(Number(v)))
export const compact = (v) => (isEmpty(v) ? '—' : CURRENCY + compactFmt.format(Number(v)))

export function date(v) {
  if (isEmpty(v)) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00` : v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

export function datetime(v) {
  if (isEmpty(v)) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export const label = (v) =>
  isEmpty(v) ? '—' : String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const bytes = (n) => {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

export const today = () => new Date().toISOString().slice(0, 10)

// Generic cell formatter used by tables that render arbitrary SQL results
export function autoFormat(key, value) {
  if (value === null || value === undefined) return <span className="muted">NULL</span>
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'number' && /(amount|rent|paid|due|balance|income|expense|salary|payroll|cost|collected|invoiced|spent|outstanding|deposit|profit|net|debit|credit|total)/i.test(key))
    return money(value)
  return String(value)
}
