// Video link helpers for watch-together rooms.
// Mirrors the backend classifyVideo rules: YouTube watch/share/embed/
// shorts URLs play via the IFrame adapter, raw video files via <video>,
// anything else (e.g. playmogo /e/ links) via a generic <iframe>.

import { backendUrl } from "../lib/api";

const DEFAULT_VIDEO = (import.meta.env.VITE_DEFAULT_VIDEO_URL as string | undefined) ?? backendUrl('default-video.mp4')

export function defaultVideoUrl(): string {
  return DEFAULT_VIDEO
}

export type RoomVideoType = 'none' | 'direct' | 'youtube' | 'embed'

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
  if (isDirectVideoUrl(url)) return { type: 'direct', id: url }
  return { type: 'embed', id: url }
}

// Path suffixes playable by a plain <video> element; anything else
// non-YouTube is treated as a generic embed page (<iframe>).
const DIRECT_EXTS = ['.mp4', '.webm', '.ogg', '.ogv', '.m3u8', '.mpd', '.mov', '.m4v']

export function isDirectVideoUrl(raw: string): boolean {
  let s = raw.trim().toLowerCase()
  const q = s.indexOf('?')
  if (q >= 0) s = s.slice(0, q)
  const h = s.indexOf('#')
  if (h >= 0) s = s.slice(0, h)
  return DIRECT_EXTS.some((ext) => s.endsWith(ext))
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
