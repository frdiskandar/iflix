import ChipRow from '../components/ChipRow.tsx'
import Hero from '../components/Hero.tsx'
import HeroCurve from '../components/HeroCurve.tsx'
import MovieRow from '../components/MovieRow.tsx'
import { useHomeContent } from '../hooks/useHomeContent.ts'
import { useLenis } from '../hooks/useLenis.ts'

export default function HomePage() {
  useLenis()
  const {
    heroSlides,
    movies,
    series,
    browse,
    trendingTop,
    trendingKeywords,
    collections,
    leaderboard,
    genres,
    loading,
    errors,
    retry,
  } = useHomeContent()

  return (
    <main>
      <Hero items={heroSlides} loading={loading} error={errors.homepage} />
      <HeroCurve />
      <MovieRow
        title="Sedang Tren (Top 10)"
        items={trendingTop}
        loading={loading}
        error={errors.trending}
        onRetry={retry}
      />
      <ChipRow title="Pencarian Populer" items={trendingKeywords} loading={loading} />
      <MovieRow title="Film Terbaru" items={movies} loading={loading} error={errors.movies} onRetry={retry} />
      <MovieRow title="Serial TV" items={series} loading={loading} error={errors.series} onRetry={retry} />
      <MovieRow
        title="Top Bulan Ini"
        items={leaderboard}
        loading={loading}
        error={errors.leaderboard}
        onRetry={retry}
      />
      <MovieRow
        title="Koleksi & Universe"
        items={collections}
        loading={loading}
        error={errors.collections}
        onRetry={retry}
      />
      <ChipRow
        title="Jelajahi Genre"
        items={genres.map((g) => g.name)}
        loading={loading}
        error={errors.genres}
      />
      <MovieRow title="Jelajahi" items={browse} loading={loading} error={errors.browse} onRetry={retry} />
    </main>
  )
}
