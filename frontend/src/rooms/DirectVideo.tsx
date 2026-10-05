import { forwardRef, useImperativeHandle, useRef } from 'react'

// Imperative handle driven ONLY by room stateSync (VideoStage).
// Player events never send controls, so there is no echo loop.
export interface PlayerHandle {
  play(): void
  pause(): void
  seekTo(ms: number): void
  getTimeMs(): number
  durationMs(): number | null
  isPaused(): boolean
}

interface DirectProps {
  src: string
  onEnded?: () => void
  onDuration?: (ms: number) => void
}

const DirectVideo = forwardRef<PlayerHandle, DirectProps>(function DirectVideo({ src, onEnded, onDuration }, ref) {
  const el = useRef<HTMLVideoElement>(null)

  useImperativeHandle(ref, () => ({
    play() {
      void el.current?.play().catch(() => {})
    },
    pause() {
      el.current?.pause()
    },
    seekTo(ms: number) {
      if (el.current) el.current.currentTime = Math.max(0, ms / 1000)
    },
    getTimeMs() {
      return el.current ? Math.max(0, el.current.currentTime * 1000) : 0
    },
    durationMs() {
      const d = el.current?.duration
      return typeof d === 'number' && Number.isFinite(d) ? d * 1000 : null
    },
    isPaused() {
      return el.current?.paused ?? true
    },
  }))

  return (
    <video
      ref={el}
      className="room-video"
      src={src}
      controls={false}
      
      playsInline
      preload="metadata"
      onEnded={onEnded}
      onLoadedMetadata={(e) => onDuration?.(e.currentTarget.duration * 1000)}
    />
  )
})

export default DirectVideo
