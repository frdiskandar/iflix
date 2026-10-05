# AGENTS.md — stream-platform

Greenfield monorepo for multi-user watch-together video streaming.
One room watches one video at the same position; any member can play / pause / seek / change video.

## Intended layout (create as needed, keep boundaries)

- `frontend/` — React + Vite + TypeScript. Only rendering + optimistic UI. No playback authority.
- `backend/` — Go std lib only (clean scaffold; add `gorilla/websocket` only when WS sync is implemented). Room state + sync authority.
- `proto/` or `shared/` — WebSocket message schemas (JSON) + OpenAPI for REST. Single source of truth.
- `infra/` — docker-compose for local dev (app + any db). No bare `docker run` docs.

Do not merge `frontend/` and `backend/` concerns. No direct DB access from frontend.

## Core sync invariant (do not break)

- Backend owns per-room state: `{ videoId, positionMs, playing: bool, updatedAt, version }`.
- All control actions (`play`, `pause`, `seek`, `changeVideo`) go over WebSocket to backend, backend broadcasts authoritative state to all room members.
- Never trust client timestamps for other clients. Server resolves conflicts by last-writer-wins on `version`, ties broken by server time.
- Frontend re-syncs on `stateSync` message and on rejoin; use server `positionMs + elapsed` for drift correction, not local timer alone.

## Frontend notes

- Entry: `frontend/src/main.tsx`, routes in `frontend/src/App.tsx` (`/`, `/search`, `/watch/...`). Search hits `GET /api/upstream/search` (`{results,total}`, normalized by `normalizeSearch`); cards link via `watchPathFor`.
- Video element is a view, not state: always derive `<video>.currentTime` from last `stateSync`.
- Debounce seeks (~200ms); ignore echo of own message (match by `clientMsgId`).

## Backend notes

- Entry: `backend/cmd/server/main.go`. WebSocket hub per room in `backend/internal/rooms/`.
- `backend/internal/cache/`: Redis when `REDIS_ADDR` reachable (`REDIS_PASSWORD`/`REDIS_DB` optional), else in-memory map. Redis client is stdlib RESP2 — no new dependency. Never returns nil, never fails boot.
- `GET /api/upstream/*` 200 responses are cached 1h (key includes query string, `X-Cache: HIT/MISS`). Browser `Accept-Encoding` is stripped before proxying so cached bodies are always plain JSON; `Content-Encoding` is still stored/restored defensively. Errors and 404s are never cached. Health endpoints are never cached (liveness must stay live).
- Watch flow: `play-info` → countdown → claim at `unlockAt + 15s` buffer (per upstream docs; exact-0 claims get 400/403) → redeem Pentos. Claim/refresh/track POSTs forward cookies (`did` session); failed ones log `upstream: POST <path> -> <status>` server-side. Retry once on 400/403.
- Proxy strips `Origin`/`Referer`/`Authorization` (and `Cookie` except watch paths): upstream 403s foreign origins (`{"error":"Forbidden origin"}`) on mutations. `did` cookie is `Secure` — fine on localhost (trusted) and https, but breaks on plain-http LAN IPs.
- One goroutine per hub; broadcast via channels, no shared maps without mutex.
- REST only for CRUD (rooms, videos, users). Playback control is WebSocket-only.
- Auth: JWT in `Authorization: Bearer` for REST, `?token=` for WS upgrade. Validate before upgrade.

## Commands (verified)

- Frontend: `cd frontend && npm run dev` | `npm run build` (`tsc -b && vite build`) | `npm run lint` (`oxlint`). No test runner installed yet — do not use `npm test`.
- Backend: `cd backend && go run ./cmd/server` | `go vet ./...` | `go test ./...` | `gofmt -l .`
- No compose file yet — run frontend and backend separately. Do not claim `docker compose` works.

Verify with `go vet ./...` + `npm run lint` + `npm run build` before finishing.

## Conventions

- WebSocket JSON uses `snake_case` fields, `type` discriminator: `play`, `pause`, `seek`, `change_video`, `state_sync`.
- Any WS protocol change must update `proto/` + both client and server in the same PR.
- Position unit is always milliseconds (`position_ms`) on the wire.
