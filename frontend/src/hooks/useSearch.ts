import { useCallback, useEffect, useState } from 'react'
import { ApiError, fetchJson } from '../lib/api.ts'
import {
  normalizeSearch,
  type ContentItem,
  type SearchResponse,
} from '../types/content.ts'

interface SearchState {
  items: ContentItem[]
  total: number
  loading: boolean
  error: string | null
}

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 300
const RESULT_LIMIT = 24

function toMessage(err: unknown): string {
  if (err instanceof ApiError) return `Pencarian gagal (${err.status}).`
  return 'Pencarian gagal. Periksa koneksi.'
}

export function useSearch(query: string): SearchState & { retry: () => void } {
  const [state, setState] = useState<SearchState>({ items: [], total: 0, loading: false, error: null })
  const [nonce, setNonce] = useState(0)

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY_LENGTH) {
      setState({ items: [], total: 0, loading: false, error: null })
      return
    }

    const ctrl = new AbortController()
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: String(RESULT_LIMIT) })
        const payload = await fetchJson<SearchResponse>(`/search?${params.toString()}`, ctrl.signal)
        if (!cancelled) {
          const { items, total } = normalizeSearch(payload)
          setState({ items, total, loading: false, error: null })
        }
      } catch (err) {
        if (!cancelled && (err as Error)?.name !== 'AbortError') {
          setState((s) => ({ ...s, loading: false, error: toMessage(err) }))
        }
      }
    }, DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      ctrl.abort()
    }
  }, [query, nonce])

  return { ...state, retry }
}
