# API Reference — z2.idlixku.com (dengan contoh output)

Base URL: `https://z2.idlixku.com/api`
Sumber: gabungan `api-film.md` + `api-endpoints.md`, dilengkapi contoh output live (curl + UA browser, 2026-10-04).

> Wajib header: `User-Agent: Mozilla/5.0...` (tanpa UA kena Cloudflare `Just a moment...`).
> `GET /api` bare → `404 {"error":"Not Found"}` (normal, tidak ada route index).
> Publik = tanpa login. Privat (`/me/*`, `/watch-progress`, `/watchlist`, semua `POST/PATCH/PUT/DELETE`, `/admin/*`) butuh cookie `has_session`/`did` (`credentials:"include"`) atau `Authorization: Bearer <token>`. Tanpa cookie → `401 {"error":"Unauthorized"}`.
> Gambar: `https://image.tmdb.org/t/p/w500{posterPath}`, `https://image.tmdb.org/t/p/original{backdropPath}`.
> Contoh output di bawah dipotong (`...`) agar ringkas — struktur field asli, nilai asli 1 record.

Cara test cepat:

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
curl -A "$UA" https://z2.idlixku.com/api/homepage | head -c 500
curl -A "$UA" https://z2.idlixku.com/api/movies/haunted-universities-4-2026 | head -c 500
curl -A "$UA" "https://z2.idlixku.com/api/search?q=spiderman&page=1&limit=2" | head -c 500
```

---

## 1. Movies — PUBLIK ✅ live

### `GET /movies?page=&limit=&genre=&year=&sort=&country=&query=...`
List film. `pagination: {page,limit,total,totalPages}`.

```bash
curl -A "$UA" "https://z2.idlixku.com/api/movies?limit=2"
```
```json
{
  "data": [
    {
      "id": "65cd6908-21bf-4b96-90a0-402736b6e7bf",
      "title": "Haunted Universities 4",
      "slug": "haunted-universities-4-2026",
      "posterPath": "/41Bo66wbFEXlGEMQ9kYHwXy0hBm.jpg",
      "backdropPath": "/jaHKaiFxIxhTMsn0aRsYr8Uc3ul.jpg",
      "releaseDate": "2026-05-28",
      "voteAverage": "5.50",
      "viewCount": 1236,
      "quality": "WEB-DL",
      "country": "TH",
      "runtime": 128,
      "originalLanguage": "th",
      "popularityScore": 1193,
      "contentType": "movie",
      "genres": [{ "id": "ca2891d8-...", "name": "Thriller", "slug": "thriller" }],
      "commentCount": 0,
      "hasVideo": true
    }
  ],
  "pagination": { "page": 1, "limit": 2, "total": 7543, "totalPages": 3772 }
}
```

### `GET /movies/filter-options`
Opsi genre/negara/tahun untuk filter.

```bash
curl -A "$UA" https://z2.idlixku.com/api/movies/filter-options
```
```json
{
  "genres": [{ "id": "2efb1514-...", "name": "Action", "slug": "action" }],
  "countries": [{ "code": "AR", "name": "Argentina" }],
  "years": ["2026", "2025", "..."],
  "...": "bentuk sama dengan /series/filter-options"
}
```

### `GET /movies/:slug`
Detail film. Slug salah → `404 {"error":"Movie not found"}`.

```bash
curl -A "$UA" https://z2.idlixku.com/api/movies/haunted-universities-4-2026
```
```json
{
  "id": "65cd6908-21bf-4b96-90a0-402736b6e7bf",
  "tmdbId": 1610936,
  "imdbId": "tt43380212",
  "title": "Haunted Universities 4",
  "slug": "haunted-universities-4-2026",
  "originalTitle": "เทอม 4",
  "overview": "Four Thai campuses, four deadly legends...",
  "tagline": "Friends forever. Fear forever.",
  "posterPath": "/41Bo66wbFEXlGEMQ9kYHwXy0hBm.jpg",
  "backdropPath": "/jaHKaiFxIxhTMsn0aRsYr8Uc3ul.jpg",
  "backdrops": ["/jaHKaiFxIxhTMsn0aRsYr8Uc3ul.jpg", "..."],
  "releaseDate": "2026-05-28",
  "runtime": 128,
  "voteAverage": "5.50",
  "originalLanguage": "th",
  "country": "TH",
  "status": "Released",
  "trailerUrl": "https://www.youtube.com/watch?v=w8UDaA24-vA",
  "quality": "WEB-DL",
  "director": "Salinee Khemcharas",
  "viewCount": 526,
  "watchlistCount": 8,
  "genres": [{ "id": "ca2891d8-...", "tmdbId": 53, "name": "Thriller", "slug": "thriller" }],
  "cast": [
    { "tmdbPersonId": 238450, "name": "Jirayu La-ongmanee", "character": "Boss (segment \"The White Bridge\")", "profilePath": "/vlviWuIBR72VFwnWVNCUjRg47aG.jpg" }
  ]
}
```
Error:
```json
// GET /movies/slug-tidak-ada-xyz → 404
{ "error": "Movie not found" }
```

### `GET /movies/:slug/related`
Film terkait (format kartu ringkas).

```bash
curl -A "$UA" https://z2.idlixku.com/api/movies/haunted-universities-4-2026/related
```
```json
{
  "data": [
    {
      "id": "671716b8-370d-4a78-b984-bea6e4543e9d",
      "contentType": "movie",
      "title": "Haunted Universities 2nd Semester",
      "slug": "haunted-universities-2nd-semester-2022",
      "posterPath": "/7oF4PsyhcE6QmQV02I1G8FWL2KM.jpg",
      "releaseDate": "2022-03-24",
      "voteAverage": "4.30",
      "viewCount": 1233,
      "quality": "WEB-DL",
      "genres": [{ "name": "Thriller", "slug": "thriller" }],
      "commentCount": 0
    }
  ]
}
```

### Movies privat (🔒 butuh login/staff — contoh request + error)
| Method | Path | Body | Contoh output tanpa login |
|---|---|---|---|
| GET | `/movies/tmdb/search?q=&page=` | — | `401 {"error":"Unauthorized"}` |
| POST | `/movies/import-tmdb` | `{...tmdb payload}` | `401` |
| POST | `/movies/:id/reimport` | `{fields?}` / `"{}"` | `401` |
| PATCH | `/movies/:id` | `{title?, overview?, ...}` | `401` |
| DELETE | `/movies/:id` | — | `401` |

---

## 2. Series — PUBLIK ✅ live

### `GET /series?page=&limit=...`
```bash
curl -A "$UA" "https://z2.idlixku.com/api/series?limit=2"
```
```json
{
  "data": [
    {
      "id": "8b94c993-5b87-4198-95b7-cbf7ad06be0c",
      "title": "War",
      "slug": "war-2026",
      "posterPath": "/AtCR5LMuvwepTi1kipKq878Rbuq.jpg",
      "firstAirDate": "2026-10-01",
      "voteAverage": "10.00",
      "viewCount": 528,
      "country": "US",
      "numberOfSeasons": 1,
      "numberOfEpisodes": 0,
      "genres": [{ "name": "Drama", "slug": "drama" }],
      "hasVideo": false
    }
  ],
  "pagination": { "page": 1, "limit": 2, "total": 4950, "totalPages": 2475 }
}
```

### `GET /series/filter-options`
Sama bentuk dengan movies: `{genres:[{id,name,slug}], countries:[{code,name}], years:[...]}`.

### `GET /series/:slug`
Detail + `seasons[].episodes[].id` (UUID ini yang dipakai ke `play-info/episode/:uuid`).

```bash
curl -A "$UA" https://z2.idlixku.com/api/series/boruto-naruto-next-generations-2017
```
```json
{
  "id": "fd8c9b38-39d9-470e-84f3-7bbf9484f201",
  "tmdbId": 70881,
  "title": "Boruto: Naruto Next Generations",
  "slug": "boruto-naruto-next-generations-2017",
  "overview": "The life of the shinobi is beginning to change...",
  "firstAirDate": "2017-04-05",
  "numberOfSeasons": 1,
  "numberOfEpisodes": 293,
  "voteAverage": "7.83",
  "country": "JP",
  "networks": [{ "id": 98, "name": "TV Tokyo" }],
  "genres": [{ "name": "Action", "slug": "action" }],
  "seasons": [
    { "id": "9d800bae-...", "seasonNumber": 1, "episodeCount": 293, "posterPath": "/pe9TMHu4rWbETYGWgR4jQNlSkkL.jpg" }
  ],
  "cast": [{ "tmdbPersonId": 1201637, "name": "Yuko Sanpei", "character": "Uzumaki Boruto" }]
}
```

### `GET /series/:slug/season/:n/episode/:m`
Detail episode + `.series` + `.season`. Contoh S1E1 Boruto berisi `episode.id` (UUID) untuk watch.

```bash
curl -A "$UA" https://z2.idlixku.com/api/series/boruto-naruto-next-generations-2017/season/1/episode/1
```
```json
{
  "series": { "id": "fd8c9b38-...", "title": "Boruto: Naruto Next Generations", "slug": "boruto-naruto-next-generations-2017" },
  "season": { "id": "9d800bae-...", "seasonNumber": 1 },
  "episode": { "id": "b890224e-... (uuid)", "episodeNumber": 1, "name": "Episode 1", "stillPath": "/...", "airDate": "2017-04-05" }
}
```
> Catatan: `/series/war-2026/season/1` bisa `404 {"error":"Season not found"}` bila season belum ada video.

### `GET /series/:slug/related`
```bash
curl -A "$UA" https://z2.idlixku.com/api/series/boruto-naruto-next-generations-2017/related
```
```json
{
  "data": [
    {
      "id": "0f51369a-...",
      "contentType": "movie",
      "title": "Boruto: Naruto the Movie",
      "slug": "boruto-naruto-the-movie-2015",
      "posterPath": "/1k6iwC4KaPvTBt1JuaqXy3noZRY.jpg",
      "voteAverage": "7.46",
      "commentCount": 0
    }
  ]
}
```

### Series privat (🔒)
`GET /series/:slug/admin-seasons`, `GET /series/tmdb/search`, `POST /series/import-tmdb`, `POST /series/:id/import-seasons {seasonNumber?}`, `POST /series/:id/reimport`, `PATCH/DELETE /series/:id`, `POST /series/:id/seasons`, `PATCH/DELETE /series/seasons/:seasonId`, `POST /series/seasons/:seasonId/episodes`, `PATCH/DELETE /series/episodes/:episodeId`, `PUT .../reorder-episodes {episodeIds:[]}` — tanpa login semua `401 {"error":"Unauthorized"}`.

---

## 3. Browse / Search / Trending / Genre / Koleksi / Person — PUBLIK ✅ live

### `GET /browse?type=&limit=&page=&genre=&country=&year=&...`
Campuran movie+series. Ada `meta:{genre,country,year,network,language,sort}`.
```bash
curl -A "$UA" "https://z2.idlixku.com/api/browse?limit=2"
```
```json
{
  "data": [
    {
      "id": "65cd6908-...",
      "title": "Haunted Universities 4",
      "slug": "haunted-universities-4-2026",
      "voteAverage": "5.50",
      "viewCount": "1236",
      "contentType": "movie",
      "commentCount": 0
    }
  ],
  "pagination": { "page": 1, "limit": 2, "total": 12493, "totalPages": 6247 },
  "meta": { "genre": null, "country": null, "year": null, "sort": "latest" }
}
```

### `GET /browse/countries | /years | /languages`
```bash
curl -A "$UA" https://z2.idlixku.com/api/browse/countries
curl -A "$UA" https://z2.idlixku.com/api/browse/years
curl -A "$UA" https://z2.idlixku.com/api/browse/languages
```
```json
// countries
{ "data": [{ "code": "AR", "name": "Argentina" }, { "code": "AU", "name": "Australia" }] }
// years
{ "data": ["2026", "2025", "2024", "...", "1942"] }
// languages
{ "data": ["af", "ar", "bn", "cn", "...", "zu"] }
```

### `GET /browse/embed?type=movie|tv&slug=:slug`
Hanya metadata embed, **tanpa stream**. Gagal di-catch jadi `null` di client.
```bash
curl -A "$UA" "https://z2.idlixku.com/api/browse/embed?type=movie&slug=haunted-universities-4-2026"
```
```json
{
  "title": "Haunted Universities 4",
  "slug": "haunted-universities-4-2026",
  "posterPath": "/41Bo66wbFEXlGEMQ9kYHwXy0hBm.jpg",
  "overview": "Four Thai campuses...",
  "voteAverage": "5.50",
  "releaseDate": "2026-05-28",
  "quality": "WEB-DL",
  "country": "TH",
  "runtime": 128,
  "contentType": "movie"
}
```

### `GET /search?q=&page=&limit=&type=&order=`
`q` di-lowercase+trim di client.
```bash
curl -A "$UA" "https://z2.idlixku.com/api/search?q=spiderman&page=1&limit=2"
```
```json
{
  "results": [
    {
      "id": "3d5344cb-...",
      "contentType": "movie",
      "title": "Spider-Man: Brand New Day",
      "overview": "Fighting crime full-time...",
      "genres": ["Action", "Adventure", "Science Fiction"],
      "releaseDate": "2026-07-29",
      "voteAverage": 7.88,
      "viewCount": 1065791,
      "posterPath": "/iPOn6DinuVyLY17YM9mKuPofV08.jpg",
      "quality": "CAM",
      "slug": "spider-man-brand-new-day-2026",
      "commentCount": 358
    }
  ],
  "total": 18,
  "order": "popular"
}
```

### `POST /search/track` 📖 (di-catch, statistik)
```bash
curl -A "$UA" -X POST https://z2.idlixku.com/api/search/track \
  -H "Content-Type: application/json" -d '{"query":"spiderman"}'
# sukses: 200 {} / tanpa login tetap 200 (publik, best-effort)
```

### `GET /search/trending`
```bash
curl -A "$UA" https://z2.idlixku.com/api/search/trending
```
```json
{
  "trending": ["spiderman", "black clover", "resident evil", "..."],
  "trendingDetails": [
    { "query": "spiderman", "rank": 1, "delta": "same", "previousRank": 1, "comparisonAvailable": true }
  ]
}
```

### `GET /trending/top?limit=`
```bash
curl -A "$UA" "https://z2.idlixku.com/api/trending/top?limit=2"
```
```json
{
  "data": [
    {
      "id": "6d232e0c-...",
      "title": "The Mentalist",
      "slug": "the-mentalist-2008",
      "contentType": "tv_series",
      "firstAirDate": "2008-09-23",
      "voteAverage": "8.36",
      "viewCount": 2313438,
      "commentCount": 54
    }
  ]
}
```

### `GET /genres`
```bash
curl -A "$UA" https://z2.idlixku.com/api/genres
```
```json
{
  "data": [
    { "id": "2efb1514-...", "tmdbId": 28, "name": "Action", "slug": "action", "createdAt": "2026-04-02T13:49:02.560Z" }
  ]
}
```
`POST /genres`, `PATCH/DELETE /genres/:id`, `POST /genres/sync-tmdb` → 🔒 `401` tanpa login.

### `GET /collections`
```bash
curl -A "$UA" https://z2.idlixku.com/api/collections
```
```json
{
  "collections": [
    {
      "id": "de5a88c2-...",
      "slug": "marvel-cinematic-universe",
      "title": "Marvel Cinematic Universe",
      "kind": "universe",
      "posterPath": "/6yy9nQlFt2l6UVWzrfhszFCaZ5C.jpg",
      "itemCount": 55,
      "childCount": 6,
      "firstReleaseDate": "2008-04-30",
      "lastReleaseDate": "2026-01-27"
    }
  ]
}
```

### `GET /collections/:slug`
```bash
curl -A "$UA" https://z2.idlixku.com/api/collections/marvel-cinematic-universe
```
```json
{
  "collection": { "id": "de5a88c2-...", "slug": "marvel-cinematic-universe", "title": "Marvel Cinematic Universe", "kind": "universe", "itemCount": 55 },
  "breadcrumbs": [{ "slug": "marvel-cinematic-universe", "title": "Marvel Cinematic Universe" }],
  "canonicalSlug": "marvel-cinematic-universe",
  "isCanonical": true,
  "sections": [
    {
      "slug": "marvel-cinematic-universe-phase-one",
      "title": "Phase One",
      "itemCount": 6,
      "items": [{ "title": "Iron Man", "slug": "iron-man-2008", "contentType": "movie", "releaseDate": "2008-04-30" }]
    }
  ]
}
```

### `GET /collections/:slug/seo`
```bash
curl -A "$UA" https://z2.idlixku.com/api/collections/marvel-cinematic-universe/seo
```
```json
{
  "collection": { "id": "de5a88c2-...", "slug": "marvel-cinematic-universe", "title": "Marvel Cinematic Universe" },
  "breadcrumbs": [{ "slug": "marvel-cinematic-universe" }],
  "canonicalSlug": "marvel-cinematic-universe",
  "isCanonical": true,
  "sectionAnchor": null
}
```
`GET /collections/page?...`, `POST /collections/page/search {q,translationKeys,cursor,limit}` → 📖 paginasi koleksi.

### `GET /homepage`
Modul homepage (`above`, featured, ...). Sangat besar — 1 modul saja:
```bash
curl -A "$UA" https://z2.idlixku.com/api/homepage
```
```json
{
  "above": [
    {
      "id": "2095c14e-...",
      "type": "featured",
      "title": "Featured",
      "slug": "featured",
      "showAds": true,
      "data": [
        {
          "id": "1fdc17ec-...",
          "contentType": "movie",
          "content": { "id": "c0e38709-...", "title": "The Uprising", "slug": "the-uprising-2026", "posterPath": "/7TUl15TOsIvndKlgMWTtLgtEzZP.jpg", "voteAverage": "7.20" }
        }
      ]
    }
  ]
}
```

### `GET /homepage/module-ads`
```bash
curl -A "$UA" https://z2.idlixku.com/api/homepage/module-ads
```
```json
{
  "homepageAds": [
    { "id": "787b67a7-...", "name": "QQ724", "imageUrl": "https://blogger.googleusercontent.com/img/.../Gif-Ads_QQ724_728x90_kiri-2.gif", "targetUrl": "https://rebrand.ly/qq724idlxx" }
  ]
}
```
`GET /homepage/network/:id`, `/homepage/collection/:id` → 📖 item network/koleksi (butuh id dari homepage).

### `GET /person/:tmdbId`
```bash
curl -A "$UA" https://z2.idlixku.com/api/person/238450
```
```json
{
  "tmdbId": 238450,
  "name": "Jirayu La-ongmanee",
  "profilePath": "/vlviWuIBR72VFwnWVNCUjRg47aG.jpg",
  "castMovies": [
    { "id": "65cd6908-...", "title": "Haunted Universities 4", "slug": "haunted-universities-4-2026", "character": "Boss (segment \"The White Bridge\")" }
  ],
  "castSeries": [],
  "totalCredits": 5
}
```

### `GET /leaderboard?month=` 📖
```bash
curl -A "$UA" https://z2.idlixku.com/api/leaderboard
```
```json
{
  "month": "2026-10",
  "updatedAt": "2026-10-04T09:22:13.012Z",
  "topMovies": [
    { "id": "c0e38709-...", "title": "The Uprising", "slug": "the-uprising-2026", "viewCount": 75096, "monthlyViews": 50587 }
  ]
}
```

### `GET /livestreams` 📖
```bash
curl -A "$UA" https://z2.idlixku.com/api/livestreams
```
```json
{ "data": [] }
```

### `GET /plans` 📖 (publik)
```bash
curl -A "$UA" https://z2.idlixku.com/api/plans
```
```json
{
  "data": [
    {
      "id": "6f6c0c79-...",
      "name": "Regular",
      "slug": "regular",
      "type": "free",
      "price": "0.00",
      "currency": "IDR",
      "maxResolution": 1080,
      "watchParty": { "enabled": true, "maxParticipants": 20 }
    },
    { "id": "a4c8dccd-...", "name": "IDLIX+ 30 Days", "slug": "idlix-plus-30d", "type": "premium", "price": "29000.00" }
  ]
}
```

---

## 4. Watch (alur nonton) — cookie `did` ✅ live tahap gate

Urutan wajib: `movies/:slug → .id` → `play-info` (set cookie) → tunggu `unlockAt` (+15 dtk) → `claim` (cookie sama) → `redeem` ke Pentos.

### `GET /watch/play-info/movie/:movieUUID | /episode/:episodeUUID`
UUID, bukan slug! Slug → `400 {"error":"Invalid contentId"}`.
```bash
curl -c jar.txt -A "$UA" https://z2.idlixku.com/api/watch/play-info/movie/65cd6908-21bf-4b96-90a0-402736b6e7bf
```
```json
{
  "kind": "gate",
  "gateToken": "eyJ2IjoxLCJjdGkiOiJtb3ZpZSIsImNpZCI6IjY1Y2Q2OTA4LS4uLn0.hUslSBUu_8k...",
  "serverNow": 1791105785698,
  "unlockAt": 1791105800698,
  "viewerTier": "guest",
  "maxHeight": 720,
  "preroll": {
    "ad": { "id": "2190c230-...", "name": "QQ288", "imageUrl": "https://blogger.googleusercontent.com/img/.../Gif-ADs-288_Idlix.gif", "targetUrl": "https://rebrand.ly/ID288" },
    "countdownSec": 7
  }
}
```

### `POST /watch/session/claim {gateToken}`
Tunggu `unlockAt`, sertakan cookie `jar.txt`. Terlalu cepat/tanpa cookie → `400 {"error":"Invalid playback session"}`.
```bash
curl -b jar.txt -c jar.txt -A "$UA" -X POST https://z2.idlixku.com/api/watch/session/claim \
  -H "Content-Type: application/json" -d '{"gateToken":"eyJ..."}'
```
```json
{
  "kind": "pentos",
  "claim": "eyJ...",
  "claimExpiresAt": 1791105...,
  "redeemUrl": "https://e2e.majorplay.net/api/play",
  "videoId": "AIrkyi7fCHzK",
  "title": "...mkv",
  "durationSec": 7808,
  "maxHeight": 720,
  "renewalToken": "eyJ..."
}
```

### `POST {redeemUrl} {claim, mode:"browser"}` (eksternal Pentos, `credentials:omit`)
```bash
curl -A "$UA" -X POST https://e2e.majorplay.net/api/play \
  -H "Content-Type: application/json" -d '{"claim":"eyJ...","mode":"browser"}'
```
```json
{
  "code": "ok",
  "url": "https://e2e.majorplay.net/v/z3/xxx/config-844885.json?t=...",
  "expiresAt": 1791109...,
  "ttlSeconds": 3600,
  "subtitles": [{ "lang": "id", "label": "Indonesian", "path": "https://e2e.majorplay.net/v/z3/xxx/i18n/id/xxx.vtt" }]
}
```

### Tabel watch lain
| Method | Path | Auth | Contoh |
|---|---|---|---|
| POST | `/watch/session/refresh-claim` | cookie | Req `{renewalToken[, progressToken]}` → `{claim baru...}` 📖 |
| POST | `/watch/cast/session` | LOGIN | `401` tanpa login 📖 |
| POST | `/watch/cast/session/:id/refresh` | LOGIN | `401` 📖 |
| DELETE | `/watch/cast/session/:id` | LOGIN | `401` 📖 |
| GET | `/watch-progress` | LOGIN | `401 {"error":"Unauthorized"}` 📖 |
| GET | `/watch-progress/:contentType/:contentId` | LOGIN | `401` 📖 |
| PATCH | `/watch-progress` | LOGIN | Req `{contentType,contentId[,episodeId,progress,duration]}` → `401` 📖 |
| DELETE | `/watch-progress/:contentType/:contentId` | LOGIN | `401` 📖 |
| POST | `/views/track` | PUBLIK* | Req `{contentType,contentId[,episodeId]}` → `200 {}` (di-catch) 📖 |
| GET | `/watch-parties/policy` | LOGIN | `401` 📖 |
| GET/POST | `/watch-parties?...` | LOGIN | List query `cursor,limit,q,kind,...` / create + header `X-NoBrand-Watch-Party-Connection-Reservation: v1` 📖 |
| GET | `/watch-parties/:roomId/snapshot` | LOGIN | Header `X-Watch-Party-Connection-ID` 📖 |
| GET | `/watch/player-events/summary` | ADMIN | `401/403` 📖 |

---

## 5. Auth & sesi (header khusus `X-Client-Version` untuk `/auth/*`)

Tanpa login contoh:
```bash
curl -A "$UA" https://z2.idlixku.com/api/auth/me
# → 401
```
```json
{ "error": "Unauthorized" }
```
```bash
curl -A "$UA" "https://z2.idlixku.com/api/auth/availability?username=test123"
```
```json
{ "username": { "value": "test123", "available": false } }
```

| Method | Path | Contoh request → response |
|---|---|---|
| POST | `/auth/register` | `{username,email,password,...}` → `{sessionExpiresAt,...}` 📖 |
| POST | `/auth/login` | `{identifier,password,...}` → session (cookie) 📖 |
| GET | `/auth/me` | LOGIN → profil user 📖 |
| PATCH | `/auth/me` | LOGIN `{displayName,...}` 📖 |
| PATCH | `/auth/me/player-preferences` | LOGIN preferensi player 📖 |
| DELETE | `/auth/me/watch-history` | LOGIN → clear progress 📖 |
| POST | `/auth/logout` | `{scope:"local"\|"everywhere"}` 📖 |
| GET | `/auth/sessions` | LOGIN list sesi 📖 |
| POST | `/auth/sessions/revoke` | `{sessionHandle}` 📖 |
| POST | `/auth/forgot-password` | `{email}` → `{flowId(32char)}` 📖 |
| POST | `/auth/reset-password` | `{...,flowId?}` 📖 |
| POST | `/auth/verify-email` | `{code}` 📖 |
| GET/POST | `/auth/tv/pairings/:code`, `/approve`, `/deny` | approve `{userCode,password}` 📖 |

---

## 6. Data user (LOGIN — tanpa cookie semua `401`)

Contoh bentuk sukses (📖 dari JS, perlu login untuk live):

```bash
# GET /notifications?cursor=&limit=20 → LOGIN
{ "data": [{ "id": "...", "type": "...", "isRead": false }], "nextCursor": "..." }

# POST /watchlist → LOGIN
# req: {"movieId":"65cd6908-...","contentType":"movie"}
# res: {"ok":true}

# GET /watchlist/counts?contentType=movie&contentId=... → {watchlist:8, favourite:0}

# GET /comments?targetType=movie&targetId=65cd6908-...&limit=2 → PUBLIK ✅ live:
```
```json
{
  "data": [],
  "total": 0,
  "totalAll": 0,
  "nextCursor": null,
  "hasMore": false,
  "avgRating": 0,
  "ratingCount": 0,
  "surfaceAds": [{ "id": "79220988-...", "name": "Comment Ads", "imageUrl": "https://blogger.googleusercontent.com/.../comment-area.gif" }]
}
```

```bash
# GET /coins/leaderboard/holders?limit=2 → PUBLIK ✅ live:
```
```json
{
  "holders": [
    { "userId": "aa20c193-...", "username": "renebaebae", "displayName": "rinbb", "balance": 60684, "totalEarned": 60784, "points": 578, "planType": "premium" }
  ]
}
```

```bash
# GET /users/:username → PUBLIK (username, bukan /users/search GET tanpa q)
curl -A "$UA" https://z2.idlixku.com/api/users/search
# → profil user "search" (kasus khusus):
```
```json
{
  "user": { "id": "99d377e4-...", "username": "search", "displayName": "Razky", "role": "user" },
  "recentActivity": [{ "type": "episode", "title": "Flex x Cop", "slug": "flex-x-cop-2024" }]
}
```
```bash
# POST /users/search {q} tanpa login → 401
{ "error": "Unauthorized" }
```

Lainnya (📖): `/me/notification-preferences`, `/notifications/:id/read`, `/watchlist/favourite`, `/collection-bookmarks`, `/user-collections/*` (CRUD + `{expectedRevision}`), `/coins/balance|/transactions|/daily`, `POST /coins/daily/claim`, `/shares/:type/:id`, `/comments/:id/vote {value}`, `/comments/:id/pin {pinned}`.

---

## 7. Request / Plans / Payments / Shorts / Prediksi / Push / Upload ✅ sebagian live

```bash
# GET /requests?limit=2 → PUBLIK ✅
```
```json
{
  "week": "2026-09-28",
  "weekEndsAt": "2026-10-04T17:00:00.000Z",
  "total": 2783,
  "nextCursor": "4405f9a0-...",
  "hasMore": true,
  "history": [{ "week": "2026-09-21", "winner": { "title": "Barbie Mariposa", "status": "rejected", "votes": 44 } }]
}
```

```bash
# GET /shorts/feed?limit=2 → PUBLIK ✅
```
```json
{
  "data": [
    { "id": "a20253e1-...", "title": "Like Father Like Son", "src": "/uploads/shorts/2026/09/b025ac20-....mp4", "durationSec": 33, "viewCount": 4533, "likeCount": 33 }
  ],
  "nextCursor": "eyJ2IjoyLCJob3QiOn..."
}
```

```bash
# GET /predictions/markets?category=worldcup2026 → PUBLIK ✅ (status butuh login → 401)
```
```json
{
  "markets": [
    {
      "id": "10e44933-...",
      "question": "Mexico vs South Africa",
      "stage": "Group A",
      "status": "settled",
      "outcomes": [{ "code": "HOME", "label": "Mexico" }, { "code": "DRAW", "label": "Draw" }]
    }
  ]
}
```
```json
// GET /predictions/status tanpa login → 401
{ "error": "Unauthorized" }
```

```bash
# GET /push/public-key → PUBLIK ✅
```
```json
{ "publicKey": "BI3RkpKaB62JV1TTNM_Cr_SvWFtkT5vIz2gkOScG1_8RKaC1_Ux88ogXB_gI993NciVc8uxdk56dEi-8SZeipaM" }
```

Sisanya 📖 (butuh login): `POST /requests {contentType,tmdbId,maxCharge}`, `POST /requests/:id/vote {value:1}`, `POST /plans/purchase`, `POST /payments/orders`, `GET /payments/orders/:id`, `POST /redeem-codes/redeem {code}`, `POST /predictions/markets/:id/pick {outcomeId}`, `POST /shorts/:slug/view|/like`, `POST /shorts` (FormData), `POST /upload/avatar` (FormData), `POST /push/subscribe {endpoint,...}`.

---

## 8. Admin — ADMIN (login staff + `actingAdminPassword` di body mutasi)

Tanpa login semua `401`. Bentuk umum mutasi: `{...fields, actingAdminPassword:"..."}`. Detail body hanya terlihat di DevTools admin panel.

- Homepage: `GET /homepage/modules`, `POST /homepage/modules`, `PATCH/DELETE /homepage/modules/:id`, `PUT /homepage/modules/reorder {orders}`, `GET/POST /homepage/featured`, `PUT /homepage/featured/reorder`, `GET/POST /homepage/ads`.
- Users: `GET /admin/users?...`, `GET/PATCH /admin/users/:id`, `POST /admin/users/:id/ban|/unban|/role|/plan|/coins`, `GET /admin/users/staff`.
- Comments/requests: `GET /admin/comments?...`, `POST .../:id/approve|/reject`, `GET /admin/requests?...`.
- Collections/shorts/live/plans/promo/coins/predictions/settings/cache/db/health/analytics/broadcast: lihat `api-endpoints.md §8` — pola sama, tidak diulang di sini agar tidak duplikat.

---

## 9. Tabel error umum (live)

| Kasus | Contoh | Output |
|---|---|---|
| Bare `/api` | `GET /api` | `404 {"error":"Not Found"}` |
| Path singular | `GET /api/movie` | `404` |
| Slug salah | `GET /api/movies/xyz` | `404 {"error":"Movie not found"}` |
| Season kosong | `GET /api/series/war-2026/season/1` | `404 {"error":"Season not found"}` |
| Privat tanpa cookie | `GET /api/auth/me` | `401 {"error":"Unauthorized"}` |
| play-info pakai slug | `GET /watch/play-info/movie/haunted-...` | `400 {"error":"Invalid contentId"}` |
| contentType salah | `.../tv/...` | `400 {"error":"Invalid contentType"}` (hanya `movie`/`episode`) |
| claim cepat/tanpa cookie | `POST /watch/session/claim` | `400 {"error":"Invalid playback session"}` |
| Tanpa UA | `curl https://z2.idlixku.com/api/movies` (default curl UA) | HTML Cloudflare `Just a moment...`, bukan JSON |

Legenda: ✅ = terverifikasi live curl+UA 2026-10-04 · 📖 = dari JS, butuh login/admin untuk verifikasi live.
