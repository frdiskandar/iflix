import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { PlayerHandle } from './DirectVideo.tsx'

// Generic embed view (e.g. https://playmogo.com/e/xxxx).
// Unlike <video>/YouTube, a third-party embed page exposes no playback
// API, so the handle is a stub: the room clock (stateSync) stays the
// source of truth for the time display, while play/pause/seek only
// update shared state for members that can hear them.
interface EmbedProps {
  src: string
  playing: boolean
}

const EmbedVideo = forwardRef<PlayerHandle, EmbedProps>(function EmbedVideo({ src, playing }, ref) {
  const playingRef = useRef(playing)

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useImperativeHandle(ref, () => ({
    play() {},
    pause() {},
    seekTo() {},
    getTimeMs() {
      return 0
    },
    durationMs() {
      return null
    },
    isPaused() {
      return !playingRef.current
    },
    setVolume() {
      // Third-party iframe: no volume API exposed.
    },
  }))

  return (
    <iframe
      className="room-video room-embed"
      src={src}
      title="Video embed"
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
    />
  )
})

export default EmbedVideo
