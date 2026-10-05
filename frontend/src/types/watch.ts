// Watch-flow types, mirroring api-reference.md §4.
// play-info -> claim (via backend proxy cookies) -> redeem (Pentos) -> config -> <video>.

import type { RawContent } from './content.ts'

export interface GenreRef {
  id?: string | number
  name: string
  slug?: string
}

export interface CastRef {
  tmdbPersonId?: number
  name: string
  character?: string | null
  profilePath?: string | null
}

export interface MovieDetail extends RawContent {
  overview?: string
  tagline?: string | null
  releaseDate?: string
  runtime?: number | null
  trailerUrl?: string | null
  quality?: string | null
  country?: string | null
  genres?: GenreRef[] | null
  cast?: CastRef[] | null
}

export interface EpisodeInfo {
  id: string
  episodeNumber: number
  name?: string | null
  overview?: string | null
  stillPath?: string | null
  airDate?: string | null
  runtime?: number | null
}

export interface SeasonInfo {
  id: string
  seasonNumber: number
  name?: string | null
  episodeCount?: number | null
  posterPath?: string | null
  episodes?: EpisodeInfo[] | null
}

export interface SeriesDetail extends RawContent {
  overview?: string
  firstAirDate?: string
  numberOfSeasons?: number | null
  numberOfEpisodes?: number | null
  trailerUrl?: string | null
  quality?: string | null
  country?: string | null
  genres?: GenreRef[] | null
  cast?: CastRef[] | null
  seasons?: SeasonInfo[] | null
}

export interface PrerollAd {
  id?: string
  name?: string | null
  imageUrl?: string | null
  targetUrl?: string | null
}

export interface PlayGate {
  kind: string
  gateToken: string
  serverNow: number
  unlockAt: number
  viewerTier?: string | null
  maxHeight?: number | null
  preroll?: { ad?: PrerollAd | null; countdownSec?: number | null } | null
}

export interface PlayClaim {
  kind: string
  claim: string
  claimExpiresAt?: number | null
  redeemUrl: string
  videoId?: string | null
  title?: string | null
  durationSec?: number | null
  maxHeight?: number | null
  renewalToken?: string | null
}

export interface RedeemSubtitle {
  lang: string
  label?: string | null
  path: string
}

export interface RedeemResponse {
  code: string
  url: string
  expiresAt?: number | null
  ttlSeconds?: number | null
  subtitles?: RedeemSubtitle[] | null
}

// Episode payloads vary: {episodes}, {data}, {season, episodes}, or a bare array.
export function normalizeEpisodes(payload: unknown): EpisodeInfo[] {
  const pick = (v: unknown): unknown[] => {
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      for (const k of ['episodes', 'data', 'items']) {
        if (Array.isArray(o[k])) return o[k] as unknown[]
      }
    }
    return []
  }
  return pick(payload)
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as Record<string, unknown>).id === 'string')
    .map((e) => {
      const r = e as Record<string, unknown>
      const num = (v: unknown): number => (typeof v === 'number' ? v : Number.parseInt(String(v ?? '0'), 10) || 0)
      const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
      return {
        id: r.id as string,
        episodeNumber: num(r.episodeNumber ?? r.episode_number ?? r.number),
        name: str(r.name ?? r.title) ?? `Episode ${num(r.episodeNumber ?? r.episode_number ?? r.number)}`,
        overview: str(r.overview),
        stillPath: str(r.stillPath ?? r.still_path),
        airDate: str(r.airDate ?? r.air_date),
        runtime: typeof r.runtime === 'number' ? r.runtime : null,
      }
    })
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
}

// Pentos config JSON shape is not contractual: hunt for the first
// playable http(s) URL, preferring explicit source lists.
export function resolvePlayableUrl(config: unknown): string | null {
  const urls: string[] = []
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      if (/^https?:\/\/.+/i.test(v) && !/\.vtt($|\?)/i.test(v) && !/\.srt($|\?)/i.test(v)) urls.push(v)
      return
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item)
      return
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      for (const k of ['sources', 'source', 'streams', 'stream', 'files', 'file', 'videos']) {
        if (o[k] !== undefined) visit(o[k])
      }
      for (const k of ['src', 'file', 'url', 'playbackUrl', 'playUrl', 'streamUrl', 'videoUrl', 'hls', 'mp4']) {
        if (typeof o[k] === 'string') visit(o[k])
      }
    }
  }
  visit(config)
  const rank = (u: string): number => {
    if (/\.m3u8($|\?)/i.test(u)) return 0
    if (/\.mpd($|\?)/i.test(u)) return 1
    if (/\.mp4($|\?)/i.test(u)) return 2
    return 3
  }
  return urls.sort((a, b) => rank(a) - rank(b))[0] ?? null
}

export function movieWatchPath(slug: string): string {
  return `/watch/movie/${slug}`
}

export function episodeWatchPath(slug: string, season: number, episode: number): string {
  return `/watch/series/${slug}/season/${season}/episode/${episode}`
}

// Card -> watch path. Unknown/unslugged items stay unlinked.
export function watchPathFor(slug: string | undefined, contentType: string | null | undefined): string | null {
  if (!slug) return null
  const t = (contentType ?? '').toLowerCase()
  if (t === 'movie') return movieWatchPath(slug)
  if (t === 'tv_series' || t === 'tv' || t === 'series' || t === 'episode') {
    return episodeWatchPath(slug, 1, 1)
  }
  return null
}
