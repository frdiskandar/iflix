import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { posterUrl } from '../lib/image.ts'
import type { ContentItem } from '../types/content.ts'
import { watchPathFor } from '../types/watch.ts'

interface MovieRowProps {
  title: string
  items: ContentItem[]
  loading?: boolean
  error?: string
  onRetry?: () => void
}

export default function MovieRow({ title, items, loading, error, onRetry }: MovieRowProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const updateArrows = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 8)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8)
  }, [])

  useEffect(() => {
    updateArrows()
    const el = trackRef.current
    if (!el) return
    el.addEventListener('scroll', updateArrows, { passive: true })
    window.addEventListener('resize', updateArrows)
    return () => {
      el.removeEventListener('scroll', updateArrows)
      window.removeEventListener('resize', updateArrows)
    }
  }, [items, updateArrows])

  const scrollByPage = (dir: 1 | -1) => {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <section className="content-section">
      <h2 className="section-title">{title}</h2>
      {loading ? (
        <p className="row-state" aria-busy="true">
          Memuat...
        </p>
      ) : error ? (
        <p className="row-state">
          {error}{' '}
          {onRetry ? (
            <button className="btn-retry" type="button" onClick={onRetry}>
              Coba lagi
            </button>
          ) : null}
        </p>
      ) : items.length === 0 ? (
        <p className="row-state">Belum ada data.</p>
      ) : (
        <div className="movie-row-wrap">
          <button
            className="row-nav row-nav-left"
            type="button"
            aria-label={`Geser ${title} ke kiri`}
            onClick={() => scrollByPage(-1)}
            disabled={!canLeft}
            tabIndex={canLeft ? 0 : -1}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="movie-row" ref={trackRef}>
            {items.map((movie) => {
              const poster = posterUrl(movie.posterPath)
              const to = watchPathFor(movie.slug, movie.contentType)
              const card = (
                <>
                  {poster ? <img src={poster} alt={movie.title} loading="lazy" /> : null}
                  <span className="movie-card-title">{movie.title}</span>
                </>
              )
              return to ? (
                <Link className="movie-card" key={movie.id} title={movie.title} to={to}>
                  {card}
                </Link>
              ) : (
                <div className="movie-card" key={movie.id} title={movie.title}>
                  {card}
                </div>
              )
            })}
          </div>
          <button
            className="row-nav row-nav-right"
            type="button"
            aria-label={`Geser ${title} ke kanan`}
            onClick={() => scrollByPage(1)}
            disabled={!canRight}
            tabIndex={canRight ? 0 : -1}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </section>
  )
}
