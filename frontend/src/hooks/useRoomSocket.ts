import { useCallback, useEffect, useRef, useState } from 'react'
import { loadMasterKey } from '../rooms/username.ts'

// Socket hook for one watch-together room (see AGENTS.md: the <video>
// element is a view; position derives from the last stateSync).
//
// Ownership model (the important part): exactly one socket is current at
// a time. Every socket is checked against wsRef on every event, so a
// superseded socket — StrictMode double-mount, HMR/remount races — can
// neither flip the phase badge nor steal outbound traffic. A failed send
// forces one fresh cycle instead of leaving a stuck green badge.

export interface RoomMember {
  username: string
  is_master: boolean
}

export interface RoomPlayback {
  video_url: string
  video_type: string
  video_id?: string
  allow_all: boolean
  position_ms: number
  playing: boolean
  updated_at: number
  version: number
}

export interface RoomChat {
  username: string
  text: string
  at: number
  seq: number
}

export interface RoomNotice {
  kind: string
  text: string
  at: number
}

export type RoomPhase = 'connecting' | 'open' | 'reconnecting' | 'closed'

export type ControlAction = 'play' | 'pause' | 'seek' | 'change_video'

// Current position from the last stateSync (server time + elapsed).
export function currentPosition(s: RoomPlayback | null): number {
  if (!s) return 0
  if (!s.playing) return Math.max(0, s.position_ms)
  return Math.max(0, s.position_ms + (Date.now() - s.updated_at))
}

interface Wire {
  type: string
  [k: string]: unknown
}

function newMsgId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

// WS base: explicit override (exotic setups) or same-origin /ws.
// Same-origin is the default: it works on localhost, 127.0.0.1, and LAN
// devices alike (dev server proxies /ws to the backend).
const WS_BASE = ((import.meta.env.VITE_WS_BASE_URL as string | undefined) ?? '').replace(/\/$/, '')

function socketUrl(code: string, username: string): string {
  const key = loadMasterKey(code)
  const query =
    `?username=${encodeURIComponent(username)}${key ? `&master_key=${encodeURIComponent(key)}` : ''}`
  if (WS_BASE) return `${WS_BASE}/ws/rooms/${encodeURIComponent(code)}${query}`
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws/rooms/${encodeURIComponent(code)}${query}`
}

export function useRoomSocket(code: string, username: string) {
  const [phase, setPhase] = useState<RoomPhase>('connecting')
  const [selfName, setSelfName] = useState(username)
  const [members, setMembers] = useState<RoomMember[]>([])
  const [state, setState] = useState<RoomPlayback | null>(null)
  const [chats, setChats] = useState<RoomChat[]>([])
  const [notices, setNotices] = useState<RoomNotice[]>([])
  const [error, setError] = useState<string | null>(null)
  // Last outbound result, surfaced in UI so silent send failures are visible.
  const [lastSend, setLastSend] = useState<{ ok: boolean; at: number } | null>(null)
  // Bumped to force one fresh connection cycle (manual retry, send heal).
  const [epoch, setEpoch] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const lastSeq = useRef(0)
  const lastSeekAt = useRef(0)
  const attempts = useRef(0)

  // Manual retry: the effect cleanup closes the old socket, the fresh run
  // opens a new one. No explicit close here — that would race the cleanup
  // and spawn a duplicate socket.
  const reconnect = useCallback(() => setEpoch((n) => n + 1), [])

  const pushNotice = useCallback((kind: string, text: string) => {
    setNotices((ns) => [...ns.slice(-4), { kind, text, at: Date.now() }])
  }, [])

  const applyWire = useCallback(
    (msg: Wire) => {
      switch (msg.type) {
        case 'joined':
          if (typeof msg.username === 'string') setSelfName(msg.username)
          break
        case 'members':
          if (Array.isArray(msg.members)) {
            setMembers(
              (msg.members as RoomMember[]).filter((m) => typeof m?.username === 'string'),
            )
          }
          break
        case 'state_sync': {
          const m = msg as unknown as RoomPlayback
          if (typeof m.version !== 'number') break
          setState((prev) => {
            if (prev && m.version < prev.version) return prev
            return {
              video_url: String(m.video_url ?? ''),
              video_type: String(m.video_type ?? 'none'),
              video_id: typeof m.video_id === 'string' ? m.video_id : undefined,
              allow_all: m.allow_all === true,
              position_ms: Number(m.position_ms ?? 0),
              playing: m.playing === true,
              updated_at: Number(m.updated_at ?? Date.now()),
              version: m.version,
            }
          })
          break
        }
        case 'history':
          if (Array.isArray(msg.messages)) {
            const list = (msg.messages as RoomChat[]).filter((c) => typeof c?.seq === 'number')
            if (list.length > 0) {
              lastSeq.current = Math.max(lastSeq.current, ...list.map((c) => c.seq))
            }
            setChats(list.slice(-50))
          }
          break
        case 'chat': {
          const c = msg as unknown as RoomChat
          if (typeof c.seq !== 'number' || c.seq <= lastSeq.current) break
          lastSeq.current = c.seq
          setChats((cs) => [...cs.slice(-49), { username: String(c.username), text: String(c.text), at: Number(c.at), seq: c.seq }])
          break
        }
        case 'notice':
          if (typeof msg.text === 'string') pushNotice(String(msg.kind ?? 'info'), msg.text)
          break
        case 'error':
          if (typeof msg.text === 'string') pushNotice('error', msg.text)
          break
        default:
          break
      }
    },
    [pushNotice],
  )

  useEffect(() => {
    if (!code || !username) {
      setPhase('closed')
      return
    }
    attempts.current = 0
    let timer = 0
    let cancelled = false

    const schedule = () => {
      if (cancelled) return
      attempts.current += 1
      const wait = Math.min(10000, 500 * 2 ** Math.min(attempts.current, 5))
      setPhase('reconnecting')
      timer = window.setTimeout(connect, wait)
    }

    const connect = () => {
      if (cancelled) return
      setPhase((p) => (p === 'open' ? p : attempts.current === 0 ? 'connecting' : 'reconnecting'))
      let ws: WebSocket
      try {
        ws = new WebSocket(socketUrl(code, username))
      } catch {
        schedule()
        return
      }
      wsRef.current = ws
      ws.onopen = () => {
        if (cancelled || wsRef.current !== ws) {
          ws.close()
          return
        }
        attempts.current = 0
        setError(null)
        setPhase('open')
      }
      ws.onmessage = (ev) => {
        if (wsRef.current !== ws) return
        try {
          applyWire(JSON.parse(String(ev.data)) as Wire)
        } catch {
          // ignore malformed frames
        }
      }
      ws.onerror = () => {
        if (!cancelled && wsRef.current === ws) setError('Koneksi terputus, mencoba lagi...')
      }
      ws.onclose = () => {
        if (wsRef.current !== ws) return
        wsRef.current = null
        if (!cancelled) schedule()
      }
    }

    connect()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      wsRef.current?.close()
      wsRef.current = null
      setPhase('closed')
    }
  }, [code, username, applyWire, epoch])

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current
    const usable = !!ws && ws.readyState === WebSocket.OPEN
    setLastSend({ ok: usable, at: Date.now() })
    if (!usable) {
      // Heal a desynced state instead of staying stuck: one fresh cycle
      // re-syncs phase + socket within ~500ms.
      setEpoch((n) => n + 1)
      return false
    }
    try {
      ws.send(JSON.stringify(payload))
      return true
    } catch {
      setLastSend({ ok: false, at: Date.now() })
      setEpoch((n) => n + 1)
      return false
    }
  }, [])

  // Seek commits are throttled ~200ms; pass force to bypass (drag end).
  const control = useCallback(
    (action: ControlAction, opts?: { videoUrl?: string; positionMs?: number; force?: boolean }) => {
      if (action === 'seek' && !opts?.force) {
        const now = Date.now()
        if (now - lastSeekAt.current < 200) return false
        lastSeekAt.current = now
      }
      return send({
        type: 'control',
        action,
        ...(opts?.videoUrl !== undefined ? { video_url: opts.videoUrl } : {}),
        ...(opts?.positionMs !== undefined ? { position_ms: Math.max(0, Math.round(opts.positionMs)) } : {}),
        client_msg_id: newMsgId(),
      })
    },
    [send],
  )

  const chat = useCallback(
    (text: string) => {
      const t = text.trim()
      if (!t) return false
      return send({ type: 'chat', text: t.slice(0, 500), client_msg_id: newMsgId() })
    },
    [send],
  )

  const setPermission = useCallback(
    (allow: boolean) => send({ type: 'permission', allow_all_control: allow, client_msg_id: newMsgId() }),
    [send],
  )

  const isMaster = members.some((m) => m.username === selfName && m.is_master)
  const canControl = isMaster || (state?.allow_all ?? false)

  return { phase, selfName, members, isMaster, canControl, state, chats, notices, error, control, chat, setPermission, reconnect, lastSend }
}
