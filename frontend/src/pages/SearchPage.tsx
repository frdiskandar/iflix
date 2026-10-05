import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useSearch } from '../hooks/useSearch.ts'
import { posterUrl } from '../lib/image.ts'
import { watchPathFor } from '../types/watch.ts'

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const q = (params.get('q') ?? '').trim()
  const [draft, setDraft] = useState(q)
  const { items, total, loading, error, retry } = useSearch(q)

  useEffect(() => {
    setDraft(q)
  }, [q])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next = draft.trim()
    setParams(next ? { q: next } : {})
  }

  return (
    <main className="content-section search-page">
      <h1 className="section-title">Cari Film</h1>
      <form className="search-form" onSubmit={submit} role="search">
        <input
          className="search-input"
          type="search"
          name="q"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Judul film atau serial..."
          aria-label="Cari film atau serial"
          autoComplete="off"
        />
        <button className="btn btn-play search-submit" type="submit">
          Cari
        </button>
      </form>

      {q.length >= 2 ? (
        loading ? (
          <p className="row-state" aria-busy="true">
            Mencari “{q}”...
          </p>
        ) : error ? (
          <p className="row-state">
            {error}{' '}
            <button className="btn-retry" type="button" onClick={retry}>
              Coba lagi
            </button>
          </p>
        ) : items.length === 0 ? (
          <p className="row-state">Tidak ada hasil untuk “{q}”.</p>
        ) : (
          <>
            <p className="row-state">
              {total > 0 ? `${total} hasil` : 'Hasil'} untuk “{q}”
            </p>
            <div className="search-grid">
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
          </>
        )
      ) : (
        <p className="row-state">Ketik minimal 2 huruf lalu tekan Cari.</p>
      )}
    </main>
  )
}
