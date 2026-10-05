package cache

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

func TestMemorySetGetDelete(t *testing.T) {
	c := NewMemory()
	defer c.Close()
	ctx := context.Background()

	if c.Backend() != "memory" {
		t.Fatalf("Backend() = %q, want memory", c.Backend())
	}
	if _, ok := c.Get(ctx, "missing"); ok {
		t.Fatal("Get(missing) = found, want not found")
	}

	if err := c.Set(ctx, "k", "v", 0); err != nil {
		t.Fatalf("Set: %v", err)
	}
	got, ok := c.Get(ctx, "k")
	if !ok || got != "v" {
		t.Fatalf("Get = %q,%v want v,true", got, ok)
	}

	if err := c.Set(ctx, "k", "v2", 0); err != nil {
		t.Fatalf("Set overwrite: %v", err)
	}
	if got, _ := c.Get(ctx, "k"); got != "v2" {
		t.Fatalf("Get after overwrite = %q, want v2", got)
	}

	if err := c.Delete(ctx, "k"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, ok := c.Get(ctx, "k"); ok {
		t.Fatal("Get after Delete = found, want not found")
	}
	if err := c.Delete(ctx, "missing"); err != nil {
		t.Fatalf("Delete(missing) should not error: %v", err)
	}
}

func TestMemoryTTLExpiry(t *testing.T) {
	c := NewMemory()
	defer c.Close()
	ctx := context.Background()

	if err := c.Set(ctx, "short", "v", 50*time.Millisecond); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if _, ok := c.Get(ctx, "short"); !ok {
		t.Fatal("Get before expiry = not found, want found")
	}
	time.Sleep(120 * time.Millisecond)
	if _, ok := c.Get(ctx, "short"); ok {
		t.Fatal("Get after expiry = found, want not found")
	}

	if err := c.Set(ctx, "forever", "v", 0); err != nil {
		t.Fatalf("Set: %v", err)
	}
	time.Sleep(60 * time.Millisecond)
	if _, ok := c.Get(ctx, "forever"); !ok {
		t.Fatal("key without TTL expired, want persistent")
	}
}

func TestMemoryEmptyKey(t *testing.T) {
	c := NewMemory()
	defer c.Close()
	ctx := context.Background()

	if err := c.Set(ctx, "", "v", 0); err == nil {
		t.Fatal("Set(\"\") = nil error, want error")
	}
	if _, ok := c.Get(ctx, ""); ok {
		t.Fatal("Get(\"\") = found, want not found")
	}
	if err := c.Delete(ctx, ""); err == nil {
		t.Fatal("Delete(\"\") = nil error, want error")
	}
}

func TestMemoryConcurrent(t *testing.T) {
	c := NewMemory()
	defer c.Close()
	ctx := context.Background()

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			k := fmt.Sprintf("k%d", i%5)
			_ = c.Set(ctx, k, "v", time.Minute)
			_, _ = c.Get(ctx, k)
			_ = c.Delete(ctx, k)
		}(i)
	}
	wg.Wait()
}

// Without REDIS_ADDR the constructor must fall back to memory.
func TestNewFromEnvDefaultsToMemory(t *testing.T) {
	t.Setenv("REDIS_ADDR", "")
	c := NewFromEnv()
	defer c.Close()
	if c.Backend() != "memory" {
		t.Fatalf("Backend() = %q, want memory", c.Backend())
	}
}

// An unreachable Redis must not fail: it falls back to memory.
func TestNewFromEnvUnreachableFallsBack(t *testing.T) {
	t.Setenv("REDIS_ADDR", "127.0.0.1:1") // nothing listens here
	c := NewFromEnv()
	defer c.Close()
	if c.Backend() != "memory" {
		t.Fatalf("Backend() = %q, want memory fallback", c.Backend())
	}
	ctx := context.Background()
	if err := c.Set(ctx, "k", "v", 0); err != nil {
		t.Fatalf("fallback Set: %v", err)
	}
	if got, ok := c.Get(ctx, "k"); !ok || got != "v" {
		t.Fatalf("fallback Get = %q,%v", got, ok)
	}
}

// Live Redis test; runs only when REDIS_ADDR points at a real server
// (e.g. REDIS_ADDR=localhost:6379 go test ./internal/cache/ -run TestRedisLive -v).
func TestRedisLive(t *testing.T) {
	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		t.Skip("REDIS_ADDR not set, skipping live test")
	}
	c := NewFromEnv()
	defer c.Close()
	if c.Backend() != "redis" {
		t.Skipf("REDIS_ADDR=%s unreachable, fallback active", addr)
	}

	ctx := context.Background()
	key := fmt.Sprintf("test:cache:%d", time.Now().UnixNano())
	t.Cleanup(func() { _ = c.Delete(ctx, key) })

	if err := c.Set(ctx, key, "hello", time.Minute); err != nil {
		t.Fatalf("Set: %v", err)
	}
	got, ok := c.Get(ctx, key)
	if !ok || got != "hello" {
		t.Fatalf("Get = %q,%v want hello,true", got, ok)
	}
	if _, ok := c.Get(ctx, key+":missing"); ok {
		t.Fatal("Get(missing) = found, want not found")
	}
	if err := c.Delete(ctx, key); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, ok := c.Get(ctx, key); ok {
		t.Fatal("Get after Delete = found, want not found")
	}
}
