// Display-only content types for the home page (public GET endpoints).

export interface ContentItem {
  id: string | number
  title: string
  slug?: string
  posterPath?: string | null
  backdropPath?: string | null
  overview?: string
  voteAverage?: number | null
  viewCount?: number | null
  contentType?: string | null
}

export interface GenreItem {
  id: string | number
  name: string
  slug: string
}

// Raw API shapes accept both camelCase and snake_case keys.
// voteAverage upstream berupa string ("7.20") — terima string|number.
export interface RawContent {
  id: string | number
  title?: string
  name?: string
  query?: string
  slug?: string
  posterPath?: string | null
  poster_path?: string | null
  backdropPath?: string | null
  backdrop_path?: string | null
  overview?: string
  voteAverage?: number | string | null
  vote_average?: number | string | null
  popularity?: number | null
  viewCount?: number | string | null
  view_count?: number | string | null
  contentType?: string | null
  content_type?: string | null
  // Homepage module wrapper: { id,type,title,data:[{contentType,content:{...}}] }
  type?: string
  data?: Array<{ content?: RawContent | null } | RawContent> | null
  content?: RawContent | null
}

export interface ListResponse {
  data?: RawContent[] | null
}

export interface TrendingResponse {
  trending?: Array<string | RawContent> | null
  trendingDetails?: Array<{ query?: string } & RawContent> | null
}

export interface CollectionsResponse {
  collections?: RawContent[] | null
  data?: RawContent[] | null
}

export interface LeaderboardResponse {
  topMovies?: RawContent[] | null
  topSeries?: RawContent[] | null
  data?: RawContent[] | null
}

export interface GenresResponse {
  data?: GenreItem[] | null
  genres?: GenreItem[] | null
}

// /search returns { results, total, order } — note `results`, not `data`.
export interface SearchResponse {
  results?: RawContent[] | null
  total?: number | null
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? Number.parseFloat(v) : v
  return Number.isFinite(n) ? n : null
}

export function normalizeItem(raw: RawContent): ContentItem {
  return {
    id: raw.id,
    title: raw.title ?? raw.name ?? raw.query ?? 'Tanpa judul',
    slug: raw.slug,
    posterPath: raw.posterPath ?? raw.poster_path ?? null,
    backdropPath: raw.backdropPath ?? raw.backdrop_path ?? null,
    overview: raw.overview,
    voteAverage: toNumber(raw.voteAverage ?? raw.vote_average),
    viewCount: toNumber(raw.viewCount ?? raw.view_count),
    contentType: raw.contentType ?? raw.content_type ?? null,
  }
}

export function normalizeList(payload: ListResponse | RawContent[] | null | undefined): ContentItem[] {
  const arr = Array.isArray(payload) ? payload : (payload?.data ?? [])
  return arr.map(normalizeItem)
}

export function normalizeSearch(
  payload: SearchResponse | null | undefined,
): { items: ContentItem[]; total: number } {
  return {
    items: (payload?.results ?? []).map(normalizeItem),
    total: typeof payload?.total === 'number' ? payload.total : 0,
  }
}

// /search/trending -> { trending: string[], trendingDetails: [{query,rank}] }.
// Bukan kartu konten — kembalikan keyword agar bisa ditampilkan sebagai chips.
export function normalizeTrendingKeywords(
  payload: TrendingResponse | null | undefined,
): string[] {
  const arr = payload?.trendingDetails ?? payload?.trending ?? []
  return arr
    .map((t) => (typeof t === 'string' ? t : (t.query ?? t.title ?? t.name ?? '')))
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 10)
}

// Homepage asli: { above: [{type,title,data:[{content,...}]}] }.
// Ekstrak semua content kartu dari modul agar Hero/row memakai film asli,
// bukan objek modul ("Featured").
export function normalizeHomepage(
  payload: Record<string, unknown> | null | undefined,
): ContentItem[] {
  if (!payload || typeof payload !== 'object') return []
  const out: ContentItem[] = []
  for (const v of Object.values(payload)) {
    if (!Array.isArray(v)) continue
    for (const mod of v as RawContent[]) {
      if (!mod || typeof mod !== 'object') continue
      if (Array.isArray(mod.data)) {
        for (const entry of mod.data) {
          const content = (entry as { content?: RawContent }).content ?? (entry as RawContent)
          if (content && typeof content === 'object' && 'id' in content) {
            out.push(normalizeItem(content as RawContent))
          }
        }
      } else if ('id' in mod && (mod.title ?? mod.name)) {
        out.push(normalizeItem(mod))
      }
    }
  }
  return out
}

export function normalizeCollections(
  payload: CollectionsResponse | null | undefined,
): ContentItem[] {
  const arr = payload?.collections ?? payload?.data ?? []
  return arr.map(normalizeItem)
}

export function normalizeLeaderboard(
  payload: LeaderboardResponse | null | undefined,
): ContentItem[] {
  const arr = [...(payload?.topMovies ?? []), ...(payload?.topSeries ?? []), ...(payload?.data ?? [])]
  return arr.map(normalizeItem)
}

export function normalizeGenres(payload: GenresResponse | null | undefined): GenreItem[] {
  return (payload?.data ?? payload?.genres ?? []).filter((g) => g?.name)
}
