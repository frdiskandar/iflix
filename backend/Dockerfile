# ---- builder ----
FROM golang:1.27-alpine AS builder

WORKDIR /app

# Cache modules first for faster rebuilds.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# Static binary, no cgo (scratch/alpine friendly).
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /bin/server ./cmd/server

# ---- runtime ----
FROM alpine:3.20

RUN adduser -D -H appuser \
  && apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=builder /bin/server /app/server

# Optional local fallback video (ignored if absent in build context).
# COPY default-video.mp4 /app/default-video.mp4

USER appuser
EXPOSE 8080

ENV PORT=8080
ENTRYPOINT ["/app/server"]
