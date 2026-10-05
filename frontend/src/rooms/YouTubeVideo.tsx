import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { PlayerHandle } from './DirectVideo.tsx'

// Minimal YouTube IFrame API surface (no @types dependency).
interface YTPlayer {
  loadVideoById(id: string, startSeconds?: number): void
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  destroy(): void
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string
      playerVars?: Record<string, number | string>
      events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void }
    },
  ) => YTPlayer
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YTNamespace> | null = null

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('YouTube API gagal dimuat'))
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    tag.async = true
    tag.onerror = () => reject(new Error('YouTube API gagal dimuat'))
    document.head.appendChild(tag)
    window.setTimeout(() => reject(new Error('YouTube API timeout')), 15000)
  })
  return apiPromise
}

interface YouTubeProps {
  videoId: string
  onEnded?: () => void
  onDuration?: (ms: number) => void
}

const YouTubeVideo = forwardRef<PlayerHandle, YouTubeProps>(function YouTubeVideo({ videoId, onEnded, onDuration }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<YTPlayer | null>(null)
  const ended = useRef(onEnded)
  const durCb = useRef(onDuration)

  useEffect(() => {
    ended.current = onEnded
    durCb.current = onDuration
  })

  useImperativeHandle(ref, () => ({
    play() {
      player.current?.playVideo()
    },
    pause() {
      player.current?.pauseVideo()
    },
    seekTo(ms: number) {
      player.current?.seekTo(Math.max(0, ms / 1000), true)
    },
    getTimeMs() {
      try {
        return Math.max(0, (player.current?.getCurrentTime() ?? 0) * 1000)
      } catch {
        return 0
      }
    },
    durationMs() {
      try {
        const d = player.current?.getDuration() ?? 0
        return d > 0 ? d * 1000 : null
      } catch {
        return null
      }
    },
    isPaused() {
      try {
        const s = player.current?.getPlayerState()
        // YT states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
        return s !== 1 && s !== 3
      } catch {
        return true
      }
    },
  }))

  // Create once; drive video changes imperatively (no remount flicker).
  useEffect(() => {
    let dead = false
    loadApi()
      .then((yt) => {
        if (dead || !host.current) return
        player.current = new yt.Player(host.current, {
          videoId,
          playerVars: { rel: 0, playsinline: 1 },
          events: {
            onReady: () => {
              try {
                durCb.current?.((player.current?.getDuration() ?? 0) * 1000)
              } catch {
                // duration unknown until metadata arrives
              }
            },
            onStateChange: (e) => {
              if (e.data === 0) ended.current?.() // YT.ENDED
            },
          },
        })
      })
      .catch(() => {})
    return () => {
      dead = true
      player.current?.destroy()
      player.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="room-video room-yt" ref={host} />
})

export default YouTubeVideo
