const TMDB_POSTER = 'https://image.tmdb.org/t/p/w500'
const TMDB_BACKDROP = 'https://image.tmdb.org/t/p/original'

function tmdbUrl(base: string, path?: string | null): string | undefined {
  if (!path) return undefined
  if (path.startsWith('http')) return path
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function posterUrl(path?: string | null): string | undefined {
  return tmdbUrl(TMDB_POSTER, path)
}

export function backdropUrl(path?: string | null): string | undefined {
  return tmdbUrl(TMDB_BACKDROP, path)
}
