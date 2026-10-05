// Package cors provides a minimal same-origin-friendly CORS middleware
// for the local frontend (Vite dev + same-origin prod).
package cors

import (
	"net/http"
	"os"
	"strings"
)

func allowedOrigins() []string {
	if v := strings.TrimSpace(os.Getenv("FRONTEND_ORIGIN")); v != "" {
		return strings.Split(v, ",")
	}
	return []string{"http://localhost:5173", "http://localhost:4173"}
}

func matchOrigin(origin string) string {
	origin = strings.TrimSpace(origin)
	for _, o := range allowedOrigins() {
		if strings.TrimSpace(o) == origin {
			return origin
		}
	}
	return ""
}

// Middleware sets CORS headers for known frontend origins and short-circuits preflight.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := matchOrigin(r.Header.Get("Origin")); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
