import { useCallback, useEffect, useState } from 'react'
import { fetchJson } from '../lib/api.ts'
import {
  normalizeCollections,
  normalizeGenres,
  normalizeHomepage,
  normalizeLeaderboard,
  normalizeList,
  normalizeTrendingKeywords,
  type CollectionsResponse,
  type ContentItem,
  type GenreItem,
  type GenresResponse,
  type LeaderboardResponse,
  type ListResponse,
  type TrendingResponse,
} from '../types/content.ts'

interface HomeContent {
  heroSlides: ContentItem[]
  movies: ContentItem[]
  series: ContentItem[]
  browse: ContentItem[]
  trendingTop: ContentItem[]
  trendingKeywords: string[]
  collections: ContentItem[]
  leaderboard: ContentItem[]
  genres: GenreItem[]
  loading: boolean
  errors: Record<string, string>
  retry: () => void
}

const initial: HomeContent = {
  heroSlides: [],
  movies: [],
  series: [],
  browse: [],
  trendingTop: [],
  trendingKeywords: [],
  collections: [],
  leaderboard: [],
  genres: [],
  loading: true,
  errors: {},
  retry: () => {},
}

// Fallback bila /trending/top kosong: top 10 by voteAverage, dedup by id.
function top10(pool: ContentItem[]): ContentItem[] {
  const seen = new Set<string | number>()
  return pool
    .filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    .sort((a, b) => (b.voteAverage ?? 0) - (a.voteAverage ?? 0))
    .slice(0, 10)
}

export function useHomeContent(): HomeContent {
  const [state, setState] = useState<Omit<HomeContent, 'retry'>>(initial)
  const [nonce, setNonce] = useState(0)

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false

    async function load() {
      setState((s) => ({ ...s, loading: true, errors: {} }))
      const results = await Promise.allSettled([
        fetchJson<Record<string, unknown>>('/homepage', ctrl.signal),
        fetchJson<ListResponse>('/movies?page=1&limit=10', ctrl.signal),
        fetchJson<ListResponse>('/series?page=1&limit=10', ctrl.signal),
        fetchJson<ListResponse>('/browse?limit=10', ctrl.signal),
        fetchJson<ListResponse>('/trending/top?limit=10', ctrl.signal),
        fetchJson<TrendingResponse>('/search/trending', ctrl.signal),
        fetchJson<CollectionsResponse>('/collections', ctrl.signal),
        fetchJson<LeaderboardResponse>('/leaderboard', ctrl.signal),
        fetchJson<GenresResponse>('/genres', ctrl.signal),
      ])
      if (cancelled) return

      const errors: Record<string, string> = {}
      const get = <T>(r: PromiseSettledResult<T>, key: string): T | null => {
        if (r.status === 'fulfilled') return r.value
        if (!cancelled) errors[key] = r.reason instanceof Error ? r.reason.message : 'Gagal memuat'
        return null
      }

      const homepage = get(results[0], 'homepage')
      const moviesPayload = get(results[1], 'movies')
      const seriesPayload = get(results[2], 'series')
      const browsePayload = get(results[3], 'browse')
      const trendingTopPayload = get(results[4], 'trending')
      const trendingKeywordsPayload = get(results[5], 'trendingKeywords')
      const collectionsPayload = get(results[6], 'collections')
      const leaderboardPayload = get(results[7], 'leaderboard')
      const genresPayload = get(results[8], 'genres')

      const movies = normalizeList(moviesPayload)
      const series = normalizeList(seriesPayload)
      const browse = normalizeList(browsePayload)
      const trendingTopReal = normalizeList(trendingTopPayload)
      const trendingTop = trendingTopReal.length > 0 ? trendingTopReal : top10([...movies, ...browse])
      const trendingKeywords = normalizeTrendingKeywords(trendingKeywordsPayload)
      const collections = normalizeCollections(collectionsPayload)
      const leaderboard = normalizeLeaderboard(leaderboardPayload)
      const genres = normalizeGenres(genresPayload)
      const featured = normalizeHomepage(homepage)
      // Pool slide hero: dedup by id, prioritaskan yang punya backdrop,
      // maksimal 5 slide.
      const seenSlide = new Set<string | number>()
      const heroSlides = [...featured, ...trendingTop, ...movies, ...browse]
        .filter((item) => {
          if (seenSlide.has(item.id)) return false
          seenSlide.add(item.id)
          return true
        })
        .sort((a, b) => (a.backdropPath ? 0 : 1) - (b.backdropPath ? 0 : 1))
        .slice(0, 5)

      setState({
        heroSlides,
        movies,
        series,
        browse,
        trendingTop,
        trendingKeywords,
        collections,
        leaderboard,
        genres,
        loading: false,
        errors,
      })
    }

    void load()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [nonce])

  return { ...state, retry }
}
