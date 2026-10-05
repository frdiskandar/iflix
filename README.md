# IFLIX Clone — Watch Together Streaming Platform

**Tech Stack:** React 19 + Vite 8 + TypeScript + React Router 8 · Go (stdlib) + Gorilla WebSocket · Redis · RabbitMQ · Docker Compose · Nginx


https://github.com/user-attachments/assets/dc369519-c797-4ce3-b380-f2411b17069a



## Deskripsi

Clone streaming ala Netflix/IFLIX dengan fitur **watch-together**: satu room menonton satu video di posisi yang sama. Semua anggota room bisa `play` / `pause` / `seek` / `change video`, dan backend menjadi otoritas tunggal yang menyebarkan state authoritative via WebSocket ke semua anggota.

Konten film/series diambil dari upstream API (`z2.idlixku.com`) lewat proxy Go backend (`/api/upstream/*`) dengan cache 1 jam (Redis kalau ada, kalau tidak in-memory). Alur nonton mengikuti gate upstream: `play-info` → countdown → `claim` → `redeem` ke Pentos.

## Cara Menjalankan di Local

### Prasyarat

- Go 1.27+
- Node.js + npm
- (Opsional) Docker Compose — hanya untuk RabbitMQ/Redis multi-replica

### 1. Clone & env

```bash
git clone https://github.com/frdiskandar/iflix.git
cd netflix-clone
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Isi default sudah bisa jalan single-replica tanpa RabbitMQ/Redis (`RABBITMQ_URL` dan `REDIS_ADDR` kosong = mode in-process + in-memory).

### 2. Jalankan backend (terminal 1)

```bash
cd backend
go run ./cmd/server
# server listen di :8080 (atur via PORT)
```

### 3. Jalankan frontend (terminal 2)

```bash
cd frontend
npm install
npm run dev
# buka http://localhost:5173
```

Vite proxy sudah mengarahkan `/api/upstream`, `/api/v1/rooms`, `/default-video.mp4`, dan `/ws` ke `localhost:8080`, jadi tidak perlu setting CORS tambahan.

### 4. (Opsional) RabbitMQ untuk watch-together multi-replica

```bash
docker compose -f infra/docker-compose.yml up -d
RABBITMQ_URL=amqp://guest:guest@localhost:5672/ go run ./cmd/server
# Management UI: http://localhost:15672 (guest/guest)
```

### Perintah verifikasi

```bash
cd backend && go vet ./... && go test ./...
cd frontend && npm run lint && npm run build
```

## Struktur Folder

```
.
├── README.md                 # dokumen ini
├── .env.example              # template env root (compose)
├── api-reference.md          # referensi upstream API (z2.idlixku.com)
├── iflix.GIF                 # demo GIF
├── frontend/                 # React + Vite + TS — hanya rendering + optimistic UI
│   ├── src/
│   │   ├── main.tsx          # entry point
│   │   ├── App.tsx           # routes: /, /search, /watch/..., /rooms/...
│   │   ├── pages/            # HomePage, SearchPage, WatchMoviePage, WatchSeriesPage
│   │   ├── rooms/            # RoomsLanding, RoomPage (watch-together client)
│   │   ├── components/       # Header, Footer, DisclaimerModal, ...
│   │   ├── hooks/ lib/ types/
│   ├── vite.config.ts        # dev proxy /api/* dan /ws ke backend
│   ├── nginx.conf + Dockerfile # serve build + proxy same-origin
│   └── .env.example          # VITE_API_BASE_URL, VITE_WS_BASE_URL
├── backend/                  # Go stdlib — otoritas room state + sync
│   ├── cmd/server/main.go    # entry point
│   ├── internal/
│   │   ├── rooms/            # hub WebSocket per room (play/pause/seek/change_video/state_sync)
│   │   ├── upstream/         # proxy + cache GET /api/upstream/*, watch flow (play-info/claim/redeem)
│   │   ├── cache/            # Redis (RESP2 stdlib) atau in-memory map
│   │   ├── health/ cors/     # liveness + CORS
│   └── .env.example          # PORT, UPSTREAM_BASE_URL, RABBITMQ_URL, REDIS_*, FRONTEND_ORIGIN
├── proto/                    # single source of truth kontrak
│   ├── rooms.ws.json         # skema pesan WebSocket (snake_case, position_ms)
│   └── homepage.openapi.json # skema REST
├── infra/
│   └── docker-compose.yml    # service lokal (rabbitmq), app tetap jalan terpisah
└── AGENTS.md                 # aturan kontribusi (sync invariant, perintah, konvensi)
```

> Invariant inti: backend memiliki state per-room `{ videoId, positionMs, playing, updatedAt, version }`. Kontrol playback hanya lewat WebSocket, konflik diselesaikan last-writer-wins pada `version`. Frontend selalu menurunkan `<video>.currentTime` dari `stateSync` terakhir.
