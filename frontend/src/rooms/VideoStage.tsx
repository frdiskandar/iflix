import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { currentPosition, type ControlAction, type RoomPlayback } from '../hooks/useRoomSocket.ts'
import DirectVideo, { type PlayerHandle } from './DirectVideo.tsx'
import YouTubeVideo from './YouTubeVideo.tsx'
import EmbedVideo from './EmbedVideo.tsx'
import { effectiveSource, normalizeVideoUrl } from './videoLinks.ts'

interface VideoStageProps {
  state: RoomPlayback | null
  isMaster: boolean
  canControl: boolean
  control: (action: ControlAction, opts?: { videoUrl?: string; positionMs?: number; force?: boolean }) => boolean
  setLoop: (enabled: boolean) => void
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 5.14v13.72c0 .8.87 1.29 1.56.88l10.26-6.86a1.02 1.02 0 0 0 0-1.72L9.56 4.26A1.02 1.02 0 0 0 8 5.14Z" />
    </svg>
  )
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M6.5 5h3.25v14H6.5zm7.75 0H17.5v14h-3.25z" />
    </svg>
  )
}

function IconLoop() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
    </svg>
  )
}

function IconExpand() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
    </svg>
  )
}

function IconCollapse() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
    </svg>
  )
}

function IconVolume({ level }: { level: 'off' | 'low' | 'high' }) {
  const path =
    level === 'off'
      ? 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z'
      : level === 'low'
        ? 'M5 9v6h4l5 5V4L9 9H5z'
        : 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  )
}

export default function VideoStage({ state, isMaster, canControl, control, setLoop }: VideoStageProps) {
  const player = useRef<PlayerHandle | null>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const appliedVersion = useRef(-1)
  const hideTimer = useRef<number | undefined>(undefined)
  const [posMs, setPosMs] = useState(0)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [needsGesture, setNeedsGesture] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [uiVisible, setUiVisible] = useState(true)
  // Volume is local-only (like fullscreen): each member hears their own level.
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const appliedVolume = useRef('')

  const src = effectiveSource(state?.video_url ?? '')
  const sourceId = `${src.type}:${src.id}`
  // Generic embeds (<iframe>) expose no playback API: the room clock
  // stays the time source and no drift/play-state correction is attempted.
  const isEmbed = src.type === 'embed'

  // Apply each new authoritative version once: load position then play/pause.
  useEffect(() => {
    const p = player.current
    if (!p || !state || state.version === appliedVersion.current) return
    appliedVersion.current = state.version
    const target = currentPosition(state)
    if (Math.abs(p.getTimeMs() - target) > 1200) p.seekTo(target)
    if (state.playing) p.play()
    else p.pause()
  })

  // Convergence tick: drift >2.5s or play-state mismatch gets corrected.
  // The player is a view only — this never sends controls.
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = player.current
      if (!state || !p) return
      const expected = currentPosition(state)
      setPosMs(scrub ?? expected)
      const d = p.durationMs()
      if (d && d !== durationMs) setDurationMs(d)
      if (scrub !== null) return
      if (isEmbed) return
      if (Math.abs(p.getTimeMs() - expected) > 2500) p.seekTo(expected)
      const paused = p.isPaused()
      if (state.playing && paused) {
        p.play()
        setNeedsGesture(true)
      } else if (!state.playing && !paused) {
        p.pause()
      } else if (state.playing && !paused) {
        setNeedsGesture(false)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [state, scrub, durationMs, isEmbed])

  const nowMs = scrub ?? posMs
  const max = durationMs ?? Math.max(nowMs, 1)
  const seekPct = max > 0 ? Math.min(100, (nowMs / max) * 100) : 0

  const commitSeek = (ms: number) => {
    setScrub(null)
    if (canControl) control('seek', { positionMs: ms, force: true })
  }

  const onEnded = () => {
    // Loop restarts the room through the server (master only): a local
    // <video> loop would leave state_sync stale and make the drift
    // corrector bounce the player around the end of the video.
    if (state?.loop_enabled) {
      if (isMaster) control('play', { positionMs: 0, force: true })
      return
    }
    const d = player.current?.durationMs()
    if (canControl) control('pause', { positionMs: d ?? undefined, force: true })
  }

  // Fullscreen is local-only (not room-synced): it just enlarges the view.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Re-apply local volume when it changes or when the player is remounted
  // for a new source (the ref itself triggers no render). If the player is
  // not ready yet (YouTube API still loading), retry on a later render.
  useEffect(() => {
    const key = `${sourceId}|${volume}|${muted}`
    if (appliedVolume.current === key) return
    if (!player.current) return
    appliedVolume.current = key
    player.current.setVolume(volume, muted)
  })

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    const el = screenRef.current
    if (!el) return
    const req = el.requestFullscreen?.bind(el) as (() => Promise<void>) | undefined
    if (req) {
      void req().catch(() => {})
      return
    }
    const webkit = el as HTMLDivElement & { webkitRequestFullscreen?: () => void }
    webkit.webkitRequestFullscreen?.()
  }

  // Netflix-style chrome: reveal on interaction, auto-hide while playing.
  const pokeControls = () => {
    setUiVisible(true)
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (player.current && !player.current.isPaused()) setUiVisible(false)
    }, 2600)
  }

  useEffect(() => () => {
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current)
  }, [])

  const controlsVisible = uiVisible || scrub !== null || !(state?.playing ?? false)
  const loopOn = state?.loop_enabled ?? false
  const volPct = muted || volume === 0 ? 0 : Math.round(volume * 100)
  const volLevel: 'off' | 'low' | 'high' = volPct === 0 ? 'off' : volPct < 50 ? 'low' : 'high'
  const loopDisabled = !isMaster || isEmbed
  const loopTitle = isEmbed
    ? 'Loop tidak tersedia untuk mode embed'
    : !isMaster
      ? 'Hanya master room yang bisa mengubah loop'
      : loopOn
        ? 'Matikan loop video'
        : 'Aktifkan loop video'

  return (
    <section className="room-stage">
      <div
        ref={screenRef}
        className="room-screen"
        onDoubleClick={toggleFullscreen}
        onMouseMove={pokeControls}
        onMouseLeave={() => {
          if (state?.playing) setUiVisible(false)
        }}
        onTouchStart={pokeControls}
      >
        {src.type === 'youtube' ? (
          <YouTubeVideo key={sourceId} ref={player} videoId={src.id} onEnded={onEnded} onDuration={setDurationMs} />
        ) : src.type === 'embed' ? (
          <EmbedVideo key={sourceId} ref={player} src={src.id} playing={state?.playing ?? false} />
        ) : (
          <DirectVideo key={sourceId} ref={player} src={src.id} onEnded={onEnded} onDuration={setDurationMs} />
        )}
        {state && !state.playing && canControl && !isEmbed ? (
          <button
            className="room-bigplay"
            type="button"
            aria-label="Putar video"
            onClick={() => control('play', { positionMs: player.current?.getTimeMs(), force: true })}
          >
            <IconPlay />
          </button>
        ) : null}
        {needsGesture && state?.playing ? (
          <button
            className="room-unmute"
            type="button"
            onClick={() => {
              player.current?.play()
              setNeedsGesture(false)
            }}
          >
            Klik untuk memutar dengan suara
          </button>
        ) : null}

        <div
          className={`room-controls${controlsVisible ? ' room-controls-visible' : ''}`}
          onPointerDown={pokeControls}
          onFocusCapture={pokeControls}
        >
          <input
            className="room-seek"
            type="range"
            min={0}
            max={Math.max(1, Math.round(max))}
            value={Math.min(Math.round(nowMs), Math.round(max))}
            disabled={!canControl}
            aria-label="Posisi video"
            style={{ '--seek-pct': `${seekPct}%` } as CSSProperties}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => {
              if (e.key !== 'Tab') commitSeek(Number((e.target as HTMLInputElement).value))
            }}
          />
          <div className="room-controls-row">
            <button
              className="room-ctrl-btn"
              type="button"
              disabled={!canControl}
              aria-label={state?.playing ? 'Jeda' : 'Putar'}
              title={state?.playing ? 'Jeda' : 'Putar'}
              onClick={() => {
                if (!state) return
                pokeControls()
                if (state.playing) control('pause', { positionMs: player.current?.getTimeMs(), force: true })
                else control('play', { positionMs: player.current?.getTimeMs(), force: true })
              }}
            >
              {state?.playing ? <IconPause /> : <IconPlay />}
            </button>
            <div className="room-volume">
              <button
                className="room-ctrl-btn"
                type="button"
                disabled={isEmbed}
                aria-label={volPct === 0 ? 'Nyalakan suara' : 'Bisukan suara'}
                title={isEmbed ? 'Volume tidak tersedia untuk mode embed' : volPct === 0 ? 'Nyalakan suara' : 'Bisukan suara'}
                onClick={() => setMuted((m) => !m)}
              >
                <IconVolume level={volLevel} />
              </button>
              <input
                className="room-volume-slider"
                type="range"
                min={0}
                max={100}
                step={5}
                value={volPct}
                disabled={isEmbed}
                aria-label="Volume"
                style={{ '--vol-pct': `${volPct}%` } as CSSProperties}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100
                  setVolume(v)
                  if (v > 0) setMuted(false)
                }}
              />
            </div>
            <span className="room-time">
              {fmt(nowMs)}
              {durationMs ? <span className="room-time-remain">-{fmt(Math.max(0, durationMs - nowMs))}</span> : null}
            </span>
            <div className="room-controls-right">
              <button
                className={`room-ctrl-btn${loopOn ? ' room-ctrl-active' : ''}`}
                type="button"
                disabled={loopDisabled}
                aria-label="Loop video"
                aria-pressed={loopOn}
                title={loopTitle}
                onClick={() => setLoop(!loopOn)}
              >
                <IconLoop />
              </button>
              <button
                className="room-ctrl-btn"
                type="button"
                aria-label={isFullscreen ? 'Keluar fullscreen' : 'Fullscreen'}
                title={isFullscreen ? 'Keluar fullscreen' : 'Fullscreen'}
                onClick={toggleFullscreen}
              >
                {isFullscreen ? <IconCollapse /> : <IconExpand />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <form
        className="room-linkform"
        onSubmit={(e) => {
          e.preventDefault()
          const url = normalizeVideoUrl(urlInput)
          if (url && canControl) {
            control('change_video', { videoUrl: url, force: true })
            setUrlInput('')
          }
        }}
      >
        <input
          type="url"
          placeholder="Tempel link YouTube / embed / video lalu Enter"
          value={urlInput}
          disabled={!canControl}
          onChange={(e) => setUrlInput(e.target.value)}
          aria-label="Link video baru"
        />
        <button type="submit" disabled={!canControl || !urlInput.trim()}>
          Set video
        </button>
      </form>
      {isEmbed ? (
        <p className="room-hint">
          Mode embed: isi iframe berjalan sendiri — play/pause/seek room hanya tercatat sebagai status, tidak mengendalikan iframe. Loop tidak tersedia untuk mode embed.
        </p>
      ) : null}
      {!canControl ? <p className="room-hint">Hanya master room yang bisa mengontrol. Minta master mengaktifkan izin semua user.</p> : null}
    </section>
  )
}
