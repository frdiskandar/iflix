import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import MovieRow from '../components/MovieRow.tsx'
import WatchPlayer from '../components/WatchPlayer.tsx'
import { useWatchGate } from '../hooks/useWatchGate.ts'
import { fetchJson } from '../lib/api.ts'
import { backdropUrl, posterUrl } from '../lib/image.ts'
import { normalizeList, type ListResponse } from '../types/content.ts'
import { type MovieDetail } from '../types/watch.ts'

export default function WatchMoviePage() {
  const { slug = '' } = useParams()
  const [detail, setDetail] = useState<MovieDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchJson<MovieDetail>(`/movies/${slug}`, ctrl.signal)
      .then((d) => {
        if (!cancelled) {
          setDetail(d)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Gagal memuat film')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [slug, nonce])

  const [related, setRelated] = useState<ReturnType<typeof normalizeList>>([])
  useEffect(() => {
    if (!slug) return
    const ctrl = new AbortController()
    let cancelled = false
    fetchJson<ListResponse>(`/movies/${slug}/related`, ctrl.signal)
      .then((r) => {
        if (!cancelled) setRelated(normalizeList(r))
      })
      .catch(() => {})
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [slug])

  const uuid = typeof detail?.id === 'string' ? detail.id : null
  const watch = useWatchGate('movie', uuid)

  return (
    <main className="watch-page">
      <Link className="watch-back" to="/">
        ← Beranda
      </Link>
      {loading ? (
        <p className="row-state" aria-busy="true">
          Memuat film...
        </p>
      ) : error || !detail ? (
        <p className="row-state" role="alert">
          {error ?? 'Film tidak ditemukan.'}{' '}
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
                {[detail.releaseDate, detail.runtime ? `${detail.runtime} mnt` : null, detail.quality, detail.voteAverage ? `★ ${detail.voteAverage}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {detail.overview ? <p className="watch-overview">{detail.overview}</p> : null}
              {detail.genres?.length ? (
                <p className="watch-detail-meta">{detail.genres.map((g) => g.name).join(', ')}</p>
              ) : null}
            </div>
          </header>
          <WatchPlayer watch={watch} poster={posterUrl(detail.posterPath)} title={detail.title ?? slug} />
        </>
      )}
      {related.length > 0 ? <MovieRow title="Film Terkait" items={related} /> : null}
    </main>
  )
}
