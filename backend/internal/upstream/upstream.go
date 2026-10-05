// Package upstream proxies public GET endpoints plus the watch
// playback flow (play-info gate, session claim/refresh, view tracking)
// to the third-party content API. Browsers cannot call the upstream
// directly (no Access-Control-Allow-Origin for our origin), so the
// frontend calls this backend same-origin and Go forwards server-to-server.
package upstream

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"

	"stream-platform/backend/internal/cache"
)

const defaultBaseURL = "https://z2.idlixku.com/api"

// browserUA avoids the upstream Cloudflare challenge for non-browser agents.
const browserUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

// allowedPrefixes whitelists public home-page paths (after stripping
// the /api/upstream mount prefix). Anything else returns 404.
// Covers homepage enrichment: trending, collections, genres, leaderboard,
// shorts, requests, predictions (publik), comments (read), coins leaderboard.
var allowedPrefixes = []string{
	"/homepage",
	"/movies",
	"/series",
	"/browse",
	"/search",
	"/trending",
	"/collections",
	"/genres",
	"/person",
	"/leaderboard",
	"/plans",
	"/livestreams",
	"/shorts",
	"/requests",
	"/predictions/markets",
	"/predictions/leaderboard",
	"/predictions/status",
	"/comments",
	"/coins/leaderboard",
	"/push/public-key",
}

func baseURL() string {
	if v := strings.TrimSuffix(strings.TrimSpace(os.Getenv("UPSTREAM_BASE_URL")), "/"); v != "" {
		return v
	}
	return defaultBaseURL
}

// isWatchPath reports whether p belongs to the watch playback flow
// (play-info gate, session claim/refresh, view tracking).
// Watch traffic is never cached: play-info gates carry single-use
// tokens plus server-time countdowns, and claim/track are POSTs.
func isWatchPath(p string) bool {
	if strings.HasPrefix(p, "/watch/") {
		return true
	}
	return p == "/views/track" || strings.HasPrefix(p, "/views/track/")
}

// watchGETAllowed permits only play-info reads via GET.
func watchGETAllowed(p string) bool {
	return strings.HasPrefix(p, "/watch/play-info/")
}

// watchPOSTAllowed permits only claim/refresh/track writes via POST.
func watchPOSTAllowed(p string) bool {
	switch p {
	case "/watch/session/claim", "/watch/session/refresh-claim", "/views/track":
		return true
	}
	return false
}

func allowed(path string) bool {
	if path == "" {
		return false
	}
	for _, p := range allowedPrefixes {
		if path == p || strings.HasPrefix(path, p+"/") {
			return true
		}
	}
	return false
}

// cacheTTL is how long upstream responses are served from cache.
const cacheTTL = time.Hour

// maxCachedBody caps cached response bodies so one large payload cannot
// blow up Redis or process memory. Larger responses are served live.
const maxCachedBody = 5 << 20 // 5 MiB

// cachedResponse is the envelope stored in the cache (body is base64
// because upstream bytes are not guaranteed to be valid UTF-8).
// ContentEncoding is preserved so a compressed body is never served
// without the header the client needs to decode it.
type cachedResponse struct {
	Status          int    `json:"status"`
	ContentType     string `json:"content_type"`
	ContentEncoding string `json:"content_encoding,omitempty"`
	Body            string `json:"body"`
}

// Handler serves GET /api/upstream/{public-path} by reverse-proxying to upstream.
// Successful (200) responses are cached for cacheTTL; cache state is
// reported via the X-Cache: HIT/MISS header.
func Handler(w http.ResponseWriter, r *http.Request) {
	serve(w, r, nil)
}

func serve(w http.ResponseWriter, r *http.Request, c cache.Cache) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	upstreamPath := strings.TrimPrefix(r.URL.Path, "/api/upstream")
	if upstreamPath == "" {
		upstreamPath = "/"
	}
	if !allowed(upstreamPath) && !watchGETAllowed(upstreamPath) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	target, err := url.Parse(baseURL())
	if err != nil {
		http.Error(w, "bad gateway", http.StatusBadGateway)
		return
	}

	// Watch gates are single-use and time-bound: always go live.
	cacheable := c != nil && !isWatchPath(upstreamPath)
	if cacheable {
		if hit, ok := loadCached(r.Context(), c, cacheKey(r)); ok {
			w.Header().Set("Content-Type", hit.ContentType)
			if hit.ContentEncoding != "" {
				w.Header().Set("Content-Encoding", hit.ContentEncoding)
			}
			w.Header().Set("X-Cache", "HIT")
			w.WriteHeader(hit.Status)
			_, _ = w.Write(hit.raw())
			return
		}
	}

	proxy := newProxy(target, r, upstreamPath)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "bad gateway", http.StatusBadGateway)
	}

	if !cacheable {
		proxy.ServeHTTP(w, r)
		return
	}
	w.Header().Set("X-Cache", "MISS")
	rec := &recorder{ResponseWriter: w, status: http.StatusOK}
	proxy.ServeHTTP(rec, r)
	if rec.status == http.StatusOK && rec.body.Len() <= maxCachedBody {
		storeCached(r.Context(), c, cacheKey(r), cachedResponse{
			Status:          rec.status,
			ContentType:     rec.Header().Get("Content-Type"),
			ContentEncoding: rec.Header().Get("Content-Encoding"),
			Body:            base64.StdEncoding.EncodeToString(rec.body.Bytes()),
		})
	}
}

// newProxy builds a reverse proxy to the upstream content API.
// Watch paths forward the browser Cookie (the `did` playback session)
// and get their Set-Cookie Domain attributes stripped so the cookie
// sticks to our backend origin; every other path strips cookies and
// never leaks browser credentials to the third party.
func newProxy(target *url.URL, r *http.Request, upstreamPath string) *httputil.ReverseProxy {
	watch := isWatchPath(upstreamPath)
	return &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.URL.Path = singleJoin(target.Path, upstreamPath)
			req.URL.RawQuery = r.URL.RawQuery
			req.Host = target.Host
			req.Header.Set("User-Agent", browserUA)
			req.Header.Set("Accept", "application/json")
			if !watch {
				req.Header.Del("Cookie")
			}
			req.Header.Del("Authorization")
			// Strip browser Origin/Referer: upstream rejects foreign origins
			// on mutations with 403 {"error":"Forbidden origin"}. Our calls
			// are server-to-server — like the working curl flow, which
			// sends neither header.
			req.Header.Del("Origin")
			req.Header.Del("Referer")
			// Drop the browser's Accept-Encoding so Go's Transport sends its
			// own (gzip) and transparently decodes the response. Otherwise a
			// compressed body (e.g. brotli, which Go cannot decode) would pass
			// through untouched and be cached as opaque bytes.
			req.Header.Del("Accept-Encoding")
		},
		ModifyResponse: func(resp *http.Response) error {
			if watch {
				rewriteSetCookies(resp)
			}
			return nil
		},
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout: 10 * time.Second,
			}).DialContext,
			ResponseHeaderTimeout: 10 * time.Second,
		},
	}
}

// serveWatchPost proxies watch mutations (session claim/refresh, view
// tracking) with cookies forwarded. POSTs are never cached.
func serveWatchPost(w http.ResponseWriter, r *http.Request) {
	upstreamPath := strings.TrimPrefix(r.URL.Path, "/api/upstream")
	if upstreamPath == "" {
		upstreamPath = "/"
	}
	if !watchPOSTAllowed(upstreamPath) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	target, err := url.Parse(baseURL())
	if err != nil {
		http.Error(w, "bad gateway", http.StatusBadGateway)
		return
	}

	proxy := newProxy(target, r, upstreamPath)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "bad gateway", http.StatusBadGateway)
	}
	// Rekam status agar kegagalan claim/refresh/track terlihat di log
	// backend (upstream me-return 4xx/5xx apa adanya via proxy).
	rec := &recorder{ResponseWriter: w, status: http.StatusOK}
	proxy.ServeHTTP(rec, r)
	if rec.status >= 400 {
		log.Printf("upstream: POST %s -> %d", upstreamPath, rec.status)
	}
}

// rewriteSetCookies strips Domain attributes from Set-Cookie headers so
// the upstream `did` playback cookie is stored host-only for our backend
// origin instead of being rejected as a foreign-Domain cookie.
// All other attributes (Path, Expires, HttpOnly, ...) are preserved.
func rewriteSetCookies(resp *http.Response) {
	cookies := resp.Header["Set-Cookie"]
	if len(cookies) == 0 {
		return
	}
	out := make([]string, 0, len(cookies))
	for _, c := range cookies {
		out = append(out, stripCookieDomain(c))
	}
	resp.Header["Set-Cookie"] = out
}

func stripCookieDomain(c string) string {
	parts := strings.Split(c, ";")
	kept := make([]string, 0, len(parts))
	kept = append(kept, parts[0])
	for _, p := range parts[1:] {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(p)), "domain=") {
			continue
		}
		kept = append(kept, p)
	}
	return strings.Join(kept, ";")
}

func cacheKey(r *http.Request) string {
	// v2: v1 stored compressed bodies without their Content-Encoding,
	// serving garbage on HIT. Bumped to invalidate those entries.
	key := "upstream:v2:" + strings.TrimPrefix(r.URL.Path, "/api/upstream")
	if r.URL.RawQuery != "" {
		key += "?" + r.URL.RawQuery
	}
	return key
}

func loadCached(ctx context.Context, c cache.Cache, key string) (cachedResponse, bool) {
	var hit cachedResponse
	raw, ok := c.Get(ctx, key)
	if !ok {
		return hit, false
	}
	var env cachedResponse
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		return hit, false
	}
	if env.Status == 0 {
		return hit, false
	}
	return env, true
}

func storeCached(ctx context.Context, c cache.Cache, key string, res cachedResponse) {
	raw, err := json.Marshal(res)
	if err != nil {
		return
	}
	_ = c.Set(ctx, key, string(raw), cacheTTL)
}

func (c cachedResponse) raw() []byte {
	b, err := base64.StdEncoding.DecodeString(c.Body)
	if err != nil {
		return nil
	}
	return b
}

// recorder captures the proxied response so it can be cached.
type recorder struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (r *recorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *recorder) Write(b []byte) (int, error) {
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}

func singleJoin(a, b string) string {
	return strings.TrimSuffix(a, "/") + "/" + strings.TrimPrefix(b, "/")
}

// RegisterRoutes wires the proxy onto mux. Cacheable GET responses are
// cached for cacheTTL via c; pass nil to disable caching. Watch gates
// are always live and watch mutations are never cached.
func RegisterRoutes(mux *http.ServeMux, c cache.Cache) {
	mux.HandleFunc("GET /api/upstream/", func(w http.ResponseWriter, r *http.Request) {
		serve(w, r, c)
	})
	mux.HandleFunc("POST /api/upstream/", serveWatchPost)
}
