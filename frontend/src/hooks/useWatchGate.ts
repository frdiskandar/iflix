import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, fetchJson, postJson } from '../lib/api.ts'
import {
  resolvePlayableUrl,
  type PlayClaim,
  type PlayGate,
  type RedeemResponse,
  type RedeemSubtitle,
} from '../types/watch.ts'

export type WatchKind = 'movie' | 'episode'

export type WatchPhase =
  | 'idle'
  | 'gating' // fetching play-info
  | 'locked' // waiting for unlockAt countdown
  | 'claiming'
  | 'redeeming'
  | 'ready'
  | 'error'

export interface WatchState {
  phase: WatchPhase
  // Play-info gate (preroll ad + unlock countdown).
  gate: PlayGate | null
  unlockInSec: number
  // Resolved playback.
  playableUrl: string | null
  subtitles: RedeemSubtitle[]
  videoTitle: string | null
  maxHeight: number | null
  error: string | null
  retry: () => void
}

interface RedeemBody {
  claim: string
  mode: 'browser'
}

// Buffer setelah unlockAt sebelum claim pertama, sesuai api-reference.md §4:
// "tunggu unlockAt (+15 dtk) → claim". Klaim tepat di detik 0 rawan ditolak
// server (skew jam + gate belum dibuka) dengan 400/403.
const CLAIM_BUFFER_MS = 15_000

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'Gagal memuat video'
  // Upstream menolak klaim (mis. terlalu dini / tanpa cookie sesi).
  // Sertakan body agar penyebabnya terlihat, bukan sekadar status.
  const detail = err instanceof ApiError && err.body ? ` — ${err.body}` : ''
  if (/403/.test(msg)) {
    if (/claim/i.test(msg)) {
      return `Server menolak klaim sesi (403)${detail}. Tunggu countdown selesai lalu coba lagi.`
    }
    return `Akses ditolak (403)${detail}.`
  }
  if (/400/.test(msg)) {
    if (/claim/i.test(msg) || /session/i.test(msg)) {
      return 'Sesi pemutaran belum siap (Invalid playback session). Tunggu countdown lalu coba lagi.'
    }
    return 'Konten tidak valid (Invalid contentId). Coba muat ulang halaman.'
  }
  if (/404/.test(msg)) return 'Konten tidak ditemukan. Mungkin slug salah atau konten dihapus.'
  return msg
}

export function useWatchGate(kind: WatchKind, uuid: string | null): WatchState {
  const [phase, setPhase] = useState<WatchPhase>('idle')
  const [gate, setGate] = useState<PlayGate | null>(null)
  const [unlockInSec, setUnlockInSec] = useState(0)
  const [playableUrl, setPlayableUrl] = useState<string | null>(null)
  const [subtitles, setSubtitles] = useState<RedeemSubtitle[]>([])
  const [videoTitle, setVideoTitle] = useState<string | null>(null)
  const [maxHeight, setMaxHeight] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const timers = useRef<number[]>([])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    if (!uuid) {
      setPhase('idle')
      return
    }

    const ctrl = new AbortController()
    const signal = ctrl.signal
    let cancelled = false
    const later = (fn: () => void, ms: number): void => {
      timers.current.push(window.setTimeout(() => {
        if (!cancelled) fn()
      }, ms))
    }

    async function redeem(claim: PlayClaim): Promise<void> {
      setPhase('redeeming')
      // Pentos is third-party: direct browser call, no credentials.
      const res = await fetch(claim.redeemUrl, {
        method: 'POST',
        credentials: 'omit',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim: claim.claim, mode: 'browser' } satisfies RedeemBody),
        signal,
      })
      if (!res.ok) throw new Error(`POST redeem failed: ${res.status}`)
      const redeemed = (await res.json()) as RedeemResponse
      if (!redeemed.url) throw new Error('Redeem tidak mengembalikan config URL')
      const cfgRes = await fetch(redeemed.url, { credentials: 'omit', signal })
      if (!cfgRes.ok) throw new Error(`GET config failed: ${cfgRes.status}`)
      const config = (await cfgRes.json()) as unknown
      const playable = resolvePlayableUrl(config)
      if (!playable) throw new Error('Config stream tidak berisi URL video yang dikenali')
      if (cancelled) return
      setPlayableUrl(playable)
      setSubtitles(redeemed.subtitles ?? [])
      setVideoTitle(claim.title ?? null)
      setMaxHeight(claim.maxHeight ?? null)
      setPhase('ready')
      // Best-effort view tracking; never blocks playback.
      const contentType = kind === 'movie' ? 'movie' : 'episode'
      void postJson('/views/track', { contentType, contentId: uuid }).catch(() => {})
    }

    async function claim(g: PlayGate, retried: boolean): Promise<void> {
      setPhase('claiming')
      try {
        const claimed = await postJson<PlayClaim>('/watch/session/claim', { gateToken: g.gateToken }, signal)
        if (cancelled) return
        await redeem(claimed)
      } catch (err) {
        if (cancelled || signal.aborted) return
        // Claim too early / cookie race: wait out the gate once, then retry once.
        // 403 diperlakukan sama seperti 400: upstream menolak klaim yang
        // datang sebelum gate dibuka atau tanpa cookie sesi `did`.
        if (!retried && err instanceof Error && /400|403/.test(err.message)) {
          const waitMs = Math.max(0, g.unlockAt + CLAIM_BUFFER_MS - Date.now()) + 1000
          later(() => {
            void claim(g, true).catch((e: unknown) => {
              if (!cancelled) {
                setError(friendlyError(e))
                setPhase('error')
              }
            })
          }, waitMs)
          return
        }
        throw err
      }
    }

    async function load(): Promise<void> {
      setPhase('gating')
      setError(null)
      setPlayableUrl(null)
      setSubtitles([])
      try {
        const g = await fetchJson<PlayGate>(`/watch/play-info/${kind}/${uuid}`, signal)
        if (cancelled) return
        if (!g.gateToken) throw new Error('play-info tidak mengembalikan gateToken')
        setGate(g)
        setMaxHeight(g.maxHeight ?? null)
        // Server-time countdown against unlockAt + buffer, never trust
        // local timer alone. Klaim jalan setelah gate + buffer dibuka.
        const target = g.unlockAt + CLAIM_BUFFER_MS
        const tick = (): void => {
          const left = Math.max(0, Math.ceil((target - Date.now()) / 1000))
          setUnlockInSec(left)
          if (left <= 0) {
            void claim(g, false).catch((e: unknown) => {
              if (!cancelled) {
                setError(friendlyError(e))
                setPhase('error')
              }
            })
          } else {
            setPhase('locked')
            later(tick, 500)
          }
        }
        tick()
      } catch (err) {
        if (cancelled || signal.aborted) return
        setError(friendlyError(err))
        setPhase('error')
      }
    }

    void load()
    return () => {
      cancelled = true
      ctrl.abort()
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
  }, [kind, uuid, nonce])

  return { phase, gate, unlockInSec, playableUrl, subtitles, videoTitle, maxHeight, error, retry }
}
