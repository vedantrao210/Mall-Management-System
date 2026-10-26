// Thin wrapper around fetch() for the FastAPI backend.
// All requests go to relative "/api/..." URLs, so the same build works behind
// the Vite dev proxy, behind FastAPI static hosting, or behind any reverse proxy.

const TOKEN_KEY = 'mms_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (token) =>
  token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY)

let unauthorizedHandler = () => {}
export const setUnauthorizedHandler = (fn) => { unauthorizedHandler = fn }

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function formatDetail(detail) {
  if (!detail) return 'Request failed'
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // Pydantic validation errors
    return detail
      .map((e) => {
        const field = (e.loc || []).filter((p) => p !== 'body').join('.')
        const msg = (e.msg || '').replace(/^Value error, /, '')
        return field ? `${field}: ${msg}` : msg
      })
      .join(' · ')
  }
  return JSON.stringify(detail)
}

function buildUrl(path, params) {
  const url = new URL('/api' + path, window.location.origin)
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
  })
  return url
}

export async function api(path, { method = 'GET', body, params } = {}) {
  const token = getToken()
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?')
  }

  if (res.status === 401 && path !== '/auth/login') unauthorizedHandler()
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = formatDetail((await res.json()).detail)
    } catch { /* not JSON */ }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return null
  const type = res.headers.get('content-type') || ''
  return type.includes('application/json') ? res.json() : res.text()
}

// Download a file (CSV export, SQL backup) using the auth header.
export async function download(path, params, fallbackName = 'download') {
  const res = await fetch(buildUrl(path, params), {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) {
    let detail = res.statusText
    try { detail = formatDetail((await res.json()).detail) } catch { /* ignore */ }
    throw new ApiError(res.status, detail)
  }
  const disposition = res.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="([^"]+)"/)
  const blob = await res.blob()
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = match ? match[1] : fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}
