package health

import (
	"encoding/json"
	"net/http"
	"time"
)

// Response is the JSON payload for the health endpoint.
// Field names use snake_case to match the repo WS/REST convention.
type Response struct {
	Status    string `json:"status"`
	Service   string `json:"service"`
	Timestamp string `json:"timestamp"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Handler serves GET /api/v1/health.
func Handler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, Response{
		Status:    "ok",
		Service:   "stream-platform",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

// Probe serves GET /healthz as a plain-text liveness probe (k8s style).
func Probe(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

// RegisterRoutes wires health endpoints onto mux.
func RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/health", Handler)
	mux.HandleFunc("GET /healthz", Probe)
}
