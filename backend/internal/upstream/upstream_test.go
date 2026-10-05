package upstream

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"stream-platform/backend/internal/cache"
)

func testMux(t *testing.T, c cache.Cache) (*http.ServeMux, *atomic.Int64) {
	t.Helper()
	var hits atomic.Int64
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"path":"` + r.URL.Path + `"}`))
	}))
	t.Cleanup(fake.Close)
	t.Setenv("UPSTREAM_BASE_URL", fake.URL+"/api")

	mux := http.NewServeMux()
	RegisterRoutes(mux, c)
	return mux, &hits
}

func TestCacheMissThenHit(t *testing.T) {
	c := cache.NewMemory()
	defer c.Close()
	mux, hits := testMux(t, c)

	first := httptest.NewRequest(http.MethodGet, "/api/upstream/movies", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, first)
	if rec.Code != http.StatusOK {
		t.Fatalf("first status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("X-Cache"); got != "MISS" {
		t.Fatalf("first X-Cache = %q, want MISS", got)
	}

	second := httptest.NewRequest(http.MethodGet, "/api/upstream/movies", nil)
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, second)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second status = %d, want 200", rec2.Code)
	}
	if got := rec2.Header().Get("X-Cache"); got != "HIT" {
		t.Fatalf("second X-Cache = %q, want HIT", got)
	}
	if rec.Body.String() != rec2.Body.String() {
		t.Fatal("cached body differs from original")
	}
	if n := hits.Load(); n != 1 {
		t.Fatalf("upstream hits = %d, want 1 (second request served from cache)", n)
	}
}

func TestCacheKeyIncludesQuery(t *testing.T) {
	c := cache.NewMemory()
	defer c.Close()
	mux, hits := testMux(t, c)

	for _, q := range []string{"?page=1", "?page=2", "?page=1"} {
		req := httptest.NewRequest(http.MethodGet, "/api/upstream/movies"+q, nil)
		mux.ServeHTTP(httptest.NewRecorder(), req)
	}
	if n := hits.Load(); n != 2 {
		t.Fatalf("upstream hits = %d, want 2 (page=1 repeated from cache)", n)
	}
}

func TestErrorsNotCached(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "upstream down", http.StatusInternalServerError)
	}))
	t.Cleanup(fake.Close)
	t.Setenv("UPSTREAM_BASE_URL", fake.URL+"/api")

	c := cache.NewMemory()
	defer c.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, c)

	for range 2 {
		req := httptest.NewRequest(http.MethodGet, "/api/upstream/movies", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500", rec.Code)
		}
		if got := rec.Header().Get("X-Cache"); got != "MISS" {
			t.Fatalf("X-Cache = %q, want MISS (errors must not be cached)", got)
		}
	}
}

func TestDisallowedPathNotProxied(t *testing.T) {
	c := cache.NewMemory()
	defer c.Close()
	mux, hits := testMux(t, c)

	req := httptest.NewRequest(http.MethodGet, "/api/upstream/admin/secret", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if n := hits.Load(); n != 0 {
		t.Fatalf("upstream hits = %d, want 0", n)
	}
}

// Regression test for the "invalid JSON �" frontend error: the browser
// sends Accept-Encoding (gzip/br) and the upstream replies compressed.
// Both MISS and HIT must deliver plain, parseable JSON — never raw
// compressed bytes without a Content-Encoding header.
func TestGzipUpstreamServesPlainJSON(t *testing.T) {
	const payload = `{"ok":true,"movies":[]}`
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write([]byte(payload)); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	compressed := buf.Bytes()

	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Encoding", "gzip")
		_, _ = w.Write(compressed)
	}))
	t.Cleanup(fake.Close)
	t.Setenv("UPSTREAM_BASE_URL", fake.URL+"/api")

	c := cache.NewMemory()
	defer c.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, c)

	var missBody string
	for i, wantCache := range []string{"MISS", "HIT"} {
		req := httptest.NewRequest(http.MethodGet, "/api/upstream/movies", nil)
		// Browser-like request: accepts compressed encodings.
		req.Header.Set("Accept-Encoding", "gzip, deflate, br")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("req %d status = %d, want 200", i, rec.Code)
		}
		if got := rec.Header().Get("X-Cache"); got != wantCache {
			t.Fatalf("req %d X-Cache = %q, want %q", i, got, wantCache)
		}
		if enc := rec.Header().Get("Content-Encoding"); enc != "" {
			t.Fatalf("req %d Content-Encoding = %q, body must be plain JSON", i, enc)
		}
		body := rec.Body.String()
		if !json.Valid([]byte(body)) {
			t.Fatalf("req %d body is not valid JSON: %q", i, body)
		}
		if i == 0 {
			missBody = body
		} else if body != missBody {
			t.Fatal("HIT body differs from MISS body")
		}
	}
}

// The envelope must round-trip Content-Encoding so that if a compressed
// body ever reaches the cache, HIT restores the header needed to decode it.
func TestCachedContentEncodingRestored(t *testing.T) {
	c := cache.NewMemory()
	defer c.Close()
	ctx := context.Background()

	storeCached(ctx, c, "k", cachedResponse{
		Status:          http.StatusOK,
		ContentType:     "application/json",
		ContentEncoding: "gzip",
		Body:            "aGk=", // "hi"
	})
	hit, ok := loadCached(ctx, c, "k")
	if !ok {
		t.Fatal("loadCached = miss, want hit")
	}
	if hit.ContentEncoding != "gzip" {
		t.Fatalf("ContentEncoding = %q, want gzip", hit.ContentEncoding)
	}
	if string(hit.raw()) != "hi" {
		t.Fatalf("raw() = %q, want hi", string(hit.raw()))
	}
}

// Watch gates are single-use and time-bound: two identical play-info
// GETs must both go live (no X-Cache), the upstream `did` cookie must be
// relayed with its Domain attribute stripped, and the browser Cookie
// must be forwarded upstream on the second call.
func TestWatchPlayInfoLiveAndCookieRelay(t *testing.T) {
	var hits atomic.Int64
	var gotCookie atomic.Value
	gotCookie.Store("")
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		gotCookie.Store(r.Header.Get("Cookie"))
		w.Header().Set("Content-Type", "application/json")
		w.Header().Add("Set-Cookie", "did=abc123; Domain=z2.idlixku.com; Path=/; HttpOnly")
		_, _ = w.Write([]byte(`{"kind":"gate"}`))
	}))
	t.Cleanup(fake.Close)
	t.Setenv("UPSTREAM_BASE_URL", fake.URL+"/api")

	c := cache.NewMemory()
	defer c.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, c)

	for i := range 2 {
		req := httptest.NewRequest(http.MethodGet, "/api/upstream/watch/play-info/movie/some-uuid", nil)
		if i == 1 {
			req.Header.Set("Cookie", "did=abc123")
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("req %d status = %d, want 200", i, rec.Code)
		}
		if got := rec.Header().Get("X-Cache"); got != "" {
			t.Fatalf("req %d X-Cache = %q, want empty (watch must bypass cache)", i, got)
		}
		setCookie := rec.Header().Get("Set-Cookie")
		if !strings.Contains(setCookie, "did=abc123") {
			t.Fatalf("req %d Set-Cookie = %q, want did relayed", i, setCookie)
		}
		if strings.Contains(strings.ToLower(setCookie), "domain=") {
			t.Fatalf("req %d Set-Cookie = %q, Domain attribute must be stripped", i, setCookie)
		}
	}
	if n := hits.Load(); n != 2 {
		t.Fatalf("upstream hits = %d, want 2 (no caching)", n)
	}
	if got := gotCookie.Load().(string); !strings.Contains(got, "did=abc123") {
		t.Fatalf("forwarded Cookie = %q, want did=abc123", got)
	}
}

// Watch mutations go through with the browser Cookie forwarded and are
// never cached; anything outside the claim/refresh/track allowlist is 404.
func TestWatchPostClaim(t *testing.T) {
	var hits atomic.Int64
	var gotCookie atomic.Value
	gotCookie.Store("")
	var gotBody atomic.Value
	gotBody.Store("")
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		gotCookie.Store(r.Header.Get("Cookie"))
		buf := new(bytes.Buffer)
		_, _ = buf.ReadFrom(r.Body)
		gotBody.Store(buf.String())
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"kind":"pentos"}`))
	}))
	t.Cleanup(fake.Close)
	t.Setenv("UPSTREAM_BASE_URL", fake.URL+"/api")

	c := cache.NewMemory()
	defer c.Close()
	mux := http.NewServeMux()
	RegisterRoutes(mux, c)

	body := `{"gateToken":"eyJtest"}`
	req := httptest.NewRequest(http.MethodPost, "/api/upstream/watch/session/claim", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cookie", "did=abc123")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("claim status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("X-Cache"); got != "" {
		t.Fatalf("claim X-Cache = %q, want empty (POSTs are never cached)", got)
	}
	if rec.Body.String() != `{"kind":"pentos"}` {
		t.Fatalf("claim body = %q", rec.Body.String())
	}
	if got := gotCookie.Load().(string); !strings.Contains(got, "did=abc123") {
		t.Fatalf("forwarded Cookie = %q, want did=abc123", got)
	}
	if got := gotBody.Load().(string); got != body {
		t.Fatalf("forwarded body = %q, want %q", got, body)
	}
	if n := hits.Load(); n != 1 {
		t.Fatalf("upstream hits = %d, want 1", n)
	}

	for _, target := range []string{
		"/api/upstream/movies",
		"/api/upstream/watch/evil",
		"/api/upstream/watch/session/claim/extra",
	} {
		req := httptest.NewRequest(http.MethodPost, target, strings.NewReader(`{}`))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("POST %s status = %d, want 404", target, rec.Code)
		}
	}
	if n := hits.Load(); n != 1 {
		t.Fatalf("upstream hits = %d, want 1 (disallowed POSTs must not proxy)", n)
	}
}
