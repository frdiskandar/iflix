import { useEffect, useRef, useState } from 'react'
import { currentPosition, type ControlAction, type RoomPlayback } from '../hooks/useRoomSocket.ts'
import DirectVideo, { type PlayerHandle } from './DirectVideo.tsx'
import YouTubeVideo from './YouTubeVideo.tsx'
import { effectiveSource } from './videoLinks.ts'

interface VideoStageProps {
  state: RoomPlayback | null
  canControl: boolean
  control: (action: ControlAction, opts?: { videoUrl?: string; positionMs?: number; force?: boolean }) => boolean
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

export default function VideoStage({ state, canControl, control }: VideoStageProps) {
  const player = useRef<PlayerHandle | null>(null)
  const appliedVersion = useRef(-1)
  const [posMs, setPosMs] = useState(0)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [needsGesture, setNeedsGesture] = useState(false)
  const [urlInput, setUrlInput] = useState('')

  const src = effectiveSource(state?.video_url ?? '')
  const sourceId = `${src.type}:${src.id}`

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
  }, [state, scrub, durationMs])

  const nowMs = scrub ?? posMs
  const max = durationMs ?? Math.max(nowMs, 1)

  const commitSeek = (ms: number) => {
    setScrub(null)
    if (canControl) control('seek', { positionMs: ms, force: true })
  }

  const onEnded = () => {
    const d = player.current?.durationMs()
    if (canControl) control('pause', { positionMs: d ?? undefined, force: true })
  }

  return (
    <section className="room-stage">
      <div className="room-screen">
        {src.type === 'youtube' ? (
          <YouTubeVideo key={sourceId} ref={player} videoId={src.id} onEnded={onEnded} onDuration={setDurationMs} />
        ) : (
          <DirectVideo key={sourceId} ref={player} src={src.id} onEnded={onEnded} onDuration={setDurationMs} />
        )}
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
      </div>

      <div className="room-controls">
        <button
          type="button"
          disabled={!canControl}
          onClick={() => {
            if (!state) return
            if (state.playing) control('pause', { positionMs: player.current?.getTimeMs(), force: true })
            else control('play', { positionMs: player.current?.getTimeMs(), force: true })
          }}
        >
          {state?.playing ? '⏸ Pause' : '▶ Putar'}
        </button>
        <span className="room-time">
          {fmt(nowMs)} / {durationMs ? fmt(durationMs) : '--:--'}
        </span>
        <input
          className="room-seek"
          type="range"
          min={0}
          max={Math.max(1, Math.round(max))}
          value={Math.min(Math.round(nowMs), Math.round(max))}
          disabled={!canControl}
          aria-label="Posisi video"
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={(e) => commitSeek(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => {
            if (e.key !== 'Tab') commitSeek(Number((e.target as HTMLInputElement).value))
          }}
        />
      </div>

      <form
        className="room-linkform"
        onSubmit={(e) => {
          e.preventDefault()
          const url = urlInput.trim()
          if (url && canControl) {
            control('change_video', { videoUrl: url, force: true })
            setUrlInput('')
          }
        }}
      >
        <input
          type="url"
          placeholder="Tempel link YouTube / video lalu Enter"
          value={urlInput}
          disabled={!canControl}
          onChange={(e) => setUrlInput(e.target.value)}
          aria-label="Link video baru"
        />
        <button type="submit" disabled={!canControl || !urlInput.trim()}>
          Set video
        </button>
      </form>
      {!canControl ? <p className="room-hint">Hanya master room yang bisa mengontrol. Minta master mengaktifkan izin semua user.</p> : null}
    </section>
  )
}
