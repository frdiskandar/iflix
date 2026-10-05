import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { backdropUrl } from '../lib/image.ts'
import type { ContentItem } from '../types/content.ts'
import { watchPathFor } from '../types/watch.ts'

interface HeroProps {
  items?: ContentItem[]
  loading?: boolean
  error?: string
}

const AUTOPLAY_MS = 6000

export default function Hero({ items = [], loading, error }: HeroProps) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const count = items.length

  useEffect(() => {
    setIndex(0)
  }, [count])

  useEffect(() => {
    if (reducedMotion || paused || count <= 1) return
    const t = window.setTimeout(() => {
      setIndex((i) => (i + 1) % count)
    }, AUTOPLAY_MS)
    return () => window.clearTimeout(t)
  }, [index, paused, count, reducedMotion])

  if (loading) {
    return (
      <section className="hero" aria-busy="true">
        <div className="hero-backdrop" aria-hidden="true" />
        <div className="hero-content">
          <h1 className="hero-title">Memuat...</h1>
        </div>
      </section>
    )
  }

  const item = items[index] ?? null
  const backdrop = backdropUrl(item?.backdropPath)
  const title = item?.title ?? 'Streaming Video'
  const description =
    item?.overview ??
    'Nikmati pengalaman menonton yang luar biasa dengan kualitas streaming terbaik. Tonton di mana saja, kapan saja.'
  const watchTo = watchPathFor(item?.slug, item?.contentType)
  const autoplay = !reducedMotion && count > 1

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label="Sorotan"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {backdrop ? (
        <img
          key={item?.id ?? 'fallback'}
          className="hero-backdrop-img hero-fade"
          src={backdrop}
          alt=""
          aria-hidden="true"
          loading="eager"
        />
      ) : (
        <div className="hero-backdrop" aria-hidden="true" />
      )}
      <div className="hero-content hero-fade" key={`content-${item?.id ?? 'fallback'}`}>
        <h1 className="hero-title">{title}</h1>
        <p className="hero-description">{description}</p>
        {error ? <p className="hero-error">{error}</p> : null}
        <div className="hero-buttons">
          {watchTo ? (
            <Link className="btn btn-play" to={watchTo}>
              ▶ Putar
            </Link>
          ) : (
            <button className="btn btn-play" type="button" disabled>
              ▶ Putar
            </button>
          )}
          <button className="btn btn-more" type="button">
            ℹ Info Selengkapnya
          </button>
        </div>
      </div>
      {autoplay ? (
        <div className="hero-dots" role="tablist" aria-label="Pilih sorotan">
          {items.map((slide, i) => (
            <button
              key={slide.id}
              className={i === index ? 'hero-dot hero-dot-active' : 'hero-dot'}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Tampilkan ${slide.title}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
