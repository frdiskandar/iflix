// API client for same-origin backend proxy (/api/upstream/*).
// Base URL is configured via .env (VITE_API_BASE_URL). Frontend only displays data.

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'https://z2.idlixku.com/api'

export function apiUrl(path: string): string {
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
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
