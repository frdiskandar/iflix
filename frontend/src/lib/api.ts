// API client for same-origin backend proxy (/api/upstream/*).
// Base URL is configured via .env (VITE_API_BASE_URL). Frontend only displays data.
// Default is the same-origin proxy path (Vite dev forwards it to :8080,
// Docker nginx proxies it to backend). Never call the third-party API
// directly from the browser: it sends no Access-Control-Allow-Origin.

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '/api/upstream'

export function apiUrl(path: string): string {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

// Backend origin root derived from BASE_URL by stripping the
// /api/upstream mount (all configs end with it). Used for endpoints
// outside the upstream proxy (e.g. /api/v1/rooms): '' in same-origin
// setups, absolute origin when frontend and backend are split.
function backendRoot(): string {
  const suffix = '/api/upstream'
  if (BASE_URL.endsWith(suffix)) return BASE_URL.slice(0, -suffix.length)
  return BASE_URL
}

export function backendUrl(path: string): string {
  const root = backendRoot()
  return `${root}${path.startsWith('/') ? path : `/${path}`}`
}

export class ApiError extends Error {
  status: number
  method: string
  path: string
  body: string | null

  constructor(method: string, path: string, status: number, body: string | null = null) {
    super(`${method} ${path} failed: ${status}`)
    this.name = 'ApiError'
    this.method = method
    this.path = path
    this.status = status
    this.body = body
  }
}

async function readErrorBody(res: Response): Promise<string | null> {
  try {
    const text = await res.text()
    return text.slice(0, 300) || null
  } catch {
    return null
  }
}

export async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    throw new ApiError('GET', path, res.status, await readErrorBody(res))
  }
  return (await res.json()) as T
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    throw new ApiError('POST', path, res.status, await readErrorBody(res))
  }
  return (await res.json()) as T
}
