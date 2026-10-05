import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import MovieRow from '../components/MovieRow.tsx'
import WatchPlayer from '../components/WatchPlayer.tsx'
import { useWatchGate } from '../hooks/useWatchGate.ts'
import { fetchJson } from '../lib/api.ts'
import { backdropUrl, posterUrl } from '../lib/image.ts'
import { normalizeList, type ListResponse } from '../types/content.ts'
import { episodeWatchPath, normalizeEpisodes, type SeriesDetail } from '../types/watch.ts'

function parseNum(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export default function WatchSeriesPage() {
  const { slug = '', season = '1', episode = '1' } = useParams()
  const navigate = useNavigate()
  const seasonNum = parseNum(season, 1)
  const episodeNum = parseNum(episode, 1)

  const [detail, setDetail] = useState<SeriesDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [seasonEpisodes, setSeasonEpisodes] = useState<ReturnType<typeof normalizeEpisodes> | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchJson<SeriesDetail>(`/series/${slug}`, ctrl.signal)
      .then((d) => {
        if (!cancelled) {
          setDetail(d)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Gagal memuat series')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [slug, nonce])

  const seasons = useMemo(() => detail?.seasons ?? [], [detail])
  const embedded = useMemo(() => {
    for (const s of seasons) {
      if (s.seasonNumber === seasonNum && s.episodes?.length) return normalizeEpisodes(s.episodes)
    }
    return null
  }, [seasons, seasonNum])

  // Episode list for the active season: prefer embedded, else season endpoint.
  useEffect(() => {
    if (embedded) {
      setSeasonEpisodes(embedded)
      return
    }
    if (!slug || seasons.length > 0 && !seasons.some((s) => s.seasonNumber === seasonNum)) {
      setSeasonEpisodes([])
      return
    }
    const ctrl = new AbortController()
    let cancelled = false
    fetchJson<unknown>(`/series/${slug}/season/${seasonNum}`, ctrl.signal)
      .then((p) => {
        if (!cancelled) setSeasonEpisodes(normalizeEpisodes(p))
      })
      .catch(() => {
        if (!cancelled) setSeasonEpisodes([])
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [slug, seasonNum, embedded, seasons])

  const episodes = seasonEpisodes ?? []
  const active = episodes.find((e) => e.episodeNumber === episodeNum) ?? null
  const uuid = active?.id ?? null
  const watch = useWatchGate('episode', uuid)

  const [related, setRelated] = useState<ReturnType<typeof normalizeList>>([])
  useEffect(() => {
    if (!slug) return
    const ctrl = new AbortController()
    let cancelled = false
    fetchJson<ListResponse>(`/series/${slug}/related`, ctrl.signal)
      .then((r) => {
        if (!cancelled) setRelated(normalizeList(r))
      })
      .catch(() => {})
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [slug])

  const go = (s: number, e: number): void => {
    navigate(episodeWatchPath(slug, s, e))
  }

  return (
    <main className="watch-page">
      <Link className="watch-back" to="/">
        ← Beranda
      </Link>
      {loading ? (
        <p className="row-state" aria-busy="true">
          Memuat series...
        </p>
      ) : error || !detail ? (
        <p className="row-state" role="alert">
          {error ?? 'Series tidak ditemukan.'}{' '}
          <button className="btn-retry" type="button" onClick={() => setNonce((n) => n + 1)}>
            Coba lagi
          </button>
        </p>
      ) : (
        <>
          <header
            className="watch-hero"
            style={detail.backdropPath ? { backgroundImage: `url(${backdropUrl(detail.backdropPath)})` } : undefined}
          >
            <div className="watch-hero-content">
              <h1 className="watch-title">{detail.title ?? slug}</h1>
              <p className="watch-detail-meta">
                {[detail.firstAirDate, detail.numberOfSeasons ? `${detail.numberOfSeasons} season` : null, detail.voteAverage ? `★ ${detail.voteAverage}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {detail.overview ? <p className="watch-overview">{detail.overview}</p> : null}
            </div>
          </header>

          <section className="watch-selectors" aria-label="Pilih episode">
            <label>
              Season{' '}
              <select value={seasonNum} onChange={(e) => go(Number(e.target.value), 1)}>
                {(seasons.length > 0 ? seasons.map((s) => s.seasonNumber) : [seasonNum]).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Episode{' '}
              <select
                value={episodeNum}
                onChange={(e) => go(seasonNum, Number(e.target.value))}
                disabled={episodes.length === 0}
              >
                {(episodes.length > 0 ? episodes.map((e) => e.episodeNumber) : [episodeNum]).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={episodeNum <= 1} onClick={() => go(seasonNum, episodeNum - 1)}>
              ← Prev
            </button>
            <button type="button" onClick={() => go(seasonNum, episodeNum + 1)}>
              Next →
            </button>
          </section>

          {uuid ? (
            <WatchPlayer
              watch={watch}
              poster={posterUrl(detail.posterPath)}
              title={`${detail.title ?? slug} S${seasonNum}E${episodeNum}`}
            />
          ) : (
            <p className="row-state" role="alert">
              {episodes.length === 0
                ? 'Episode untuk season ini belum tersedia.'
                : `Episode ${episodeNum} tidak ditemukan di season ${seasonNum}.`}
            </p>
          )}
        </>
      )}
      {related.length > 0 ? <MovieRow title="Terkait" items={related} /> : null}
    </main>
  )
}
