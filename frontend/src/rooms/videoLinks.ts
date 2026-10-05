// Video link helpers for watch-together rooms.
// Mirrors the backend classifyVideo rules: YouTube watch/share/embed/
// shorts URLs play via the IFrame adapter, anything else via <video>.

import { backendUrl } from "../lib/api";

const DEFAULT_VIDEO = (import.meta.env.VITE_DEFAULT_VIDEO_URL as string | undefined) ?? backendUrl('default-video.mp4')

export function defaultVideoUrl(): string {
  return DEFAULT_VIDEO
}

export type RoomVideoType = 'none' | 'direct' | 'youtube'

export function youtubeId(raw: string): string {
  const s = raw.trim()
  const lower = s.toLowerCase()
  const tail = (p: string): string => {
    const i = lower.indexOf(p)
    if (i < 0) return ''
    return s.slice(i + p.length).split(/[?&#]/)[0] ?? ''
  }
  const cands: string[] = []
  if (lower.includes('youtube.com/watch')) {
    const m = /[?&]v=([^&#]+)/.exec(s)
    if (m) cands.push(m[1])
  }
  if (lower.includes('youtu.be/')) cands.push(tail('youtu.be/'))
  if (lower.includes('youtube.com/embed/')) cands.push(tail('youtube.com/embed/'))
  if (lower.includes('youtube.com/shorts/')) cands.push(tail('youtube.com/shorts/'))
  for (let c of cands) {
    // Tolerate the mistaken youtu.be/embed/{id} form.
    if (c.toLowerCase().startsWith('embed/')) c = c.slice('embed/'.length)
    c = c.split('/')[0] ?? ''
    if (c.length === 11) return c
  }
  return ''
}

export function classifyLink(raw: string): { type: RoomVideoType; id: string } {
  const url = raw.trim()
  if (!url) return { type: 'none', id: '' }
  const vid = youtubeId(url)
  if (vid) return { type: 'youtube', id: vid }
  return { type: 'direct', id: url }
}

// Canonical embed URL for any supported YouTube link.
// e.g. https://youtu.be/ZmDBbnmKpqQ?si=xxx -> https://www.youtube.com/embed/ZmDBbnmKpqQ
// Returns '' when the input is not a recognized YouTube URL.
export function youtubeEmbedUrl(raw: string): string {
  const vid = youtubeId(raw)
  if (!vid) return ''
  return `https://www.youtube.com/embed/${vid}`
}

// Normalize a user-pasted link before sending change_video:
// YouTube links become their canonical embed form, anything else is trimmed as-is.
export function normalizeVideoUrl(raw: string): string {
  const url = raw.trim()
  if (!url) return ''
  return youtubeEmbedUrl(url) || url
}

// Effective playback source: room video when set, else the bundled default.
export function effectiveSource(videoUrl: string): { type: RoomVideoType; id: string } {
  if (videoUrl.trim()) return classifyLink(videoUrl)
  return { type: 'direct', id: defaultVideoUrl() }
}
