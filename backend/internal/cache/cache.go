// Package cache provides a small key-value cache for the backend.
//
// It uses Redis when reachable, otherwise falls back to an in-memory map
// so local development works with zero setup:
//
//	REDIS_ADDR      host:port of Redis (empty = in-memory only)
//	REDIS_PASSWORD  optional Redis password
//	REDIS_DB        optional Redis database number (default 0)
//
// The Redis client speaks RESP2 over the standard library net package —
// no third-party dependency. Only GET/SET (with PX expiry)/DEL/PING are used.
package cache

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Cache is the interface all backends implement.
// Values are strings; marshal structs to JSON before storing.
type Cache interface {
	Get(ctx context.Context, key string) (string, bool)
	Set(ctx context.Context, key, value string, ttl time.Duration) error
	Delete(ctx context.Context, key string) error
	// Backend reports "redis" or "memory".
	Backend() string
	Close() error
}

const dialTimeout = 2 * time.Second

// NewFromEnv returns a Redis-backed cache when REDIS_ADDR points at a
// reachable server, otherwise an in-memory cache. It never returns nil
// and never fails: Redis dial/auth errors fall back to memory with a log line.
func NewFromEnv() Cache {
	addr := strings.TrimSpace(os.Getenv("REDIS_ADDR"))
	if addr == "" {
		return NewMemory()
	}

	password := os.Getenv("REDIS_PASSWORD")
	db := 0
	if v := strings.TrimSpace(os.Getenv("REDIS_DB")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			log.Printf("cache: invalid REDIS_DB %q, using 0", v)
		} else {
			db = n
		}
	}

	c := &redisCache{addr: addr, password: password, db: db}
	if err := c.ping(context.Background()); err != nil {
		log.Printf("cache: redis at %s unreachable (%v), using in-memory cache", addr, err)
		return NewMemory()
	}
	log.Printf("cache: using redis at %s (db %d)", addr, db)
	return c
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

type memEntry struct {
	value     string
	expiresAt time.Time // zero = no expiry
}

func (e memEntry) expired(now time.Time) bool {
	return !e.expiresAt.IsZero() && !now.Before(e.expiresAt)
}

type memoryCache struct {
	mu    sync.Mutex
	items map[string]memEntry

	stopOnce sync.Once
	stop     chan struct{}
	stopped  chan struct{}
}

// NewMemory returns an in-memory cache with lazy expiry plus a
// background sweep every minute for expired keys.
func NewMemory() Cache {
	m := &memoryCache{
		items:   make(map[string]memEntry),
		stop:    make(chan struct{}),
		stopped: make(chan struct{}),
	}
	go m.sweepLoop()
	return m
}

func (m *memoryCache) sweepLoop() {
	defer close(m.stopped)
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-m.stop:
			return
		case now := <-t.C:
			m.mu.Lock()
			for k, e := range m.items {
				if e.expired(now) {
					delete(m.items, k)
				}
			}
			m.mu.Unlock()
		}
	}
}

func (m *memoryCache) Get(_ context.Context, key string) (string, bool) {
	if key == "" {
		return "", false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.items[key]
	if !ok || e.expired(time.Now()) {
		delete(m.items, key)
		return "", false
	}
	return e.value, true
}

func (m *memoryCache) Set(_ context.Context, key, value string, ttl time.Duration) error {
	if key == "" {
		return fmt.Errorf("cache: empty key")
	}
	var exp time.Time
	if ttl > 0 {
		exp = time.Now().Add(ttl)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.items[key] = memEntry{value: value, expiresAt: exp}
	return nil
}

func (m *memoryCache) Delete(_ context.Context, key string) error {
	if key == "" {
		return fmt.Errorf("cache: empty key")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.items, key)
	return nil
}

func (m *memoryCache) Backend() string { return "memory" }

func (m *memoryCache) Close() error {
	m.stopOnce.Do(func() {
		close(m.stop)
		<-m.stopped
	})
	return nil
}

// ---------------------------------------------------------------------------
// Redis backend (minimal RESP2 client, stdlib only)
// ---------------------------------------------------------------------------

type redisCache struct {
	addr     string
	password string
	db       int
}

func (c *redisCache) Backend() string { return "redis" }

func (c *redisCache) Close() error { return nil }

// roundTrip dials, authenticates, runs one command, and closes the connection.
// One TCP connection per operation keeps the client free of stale-connection
// state; the cost is negligible at this service's traffic level.
func (c *redisCache) roundTrip(ctx context.Context, args ...string) (any, error) {
	d := &net.Dialer{Timeout: dialTimeout}
	conn, err := d.DialContext(ctx, "tcp", c.addr)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if err := conn.SetDeadline(time.Now().Add(dialTimeout)); err != nil {
		return nil, err
	}
	r := bufio.NewReader(conn)

	if c.password != "" {
		if _, err := redisDo(r, conn, "AUTH", c.password); err != nil {
			return nil, fmt.Errorf("auth: %w", err)
		}
	}
	if c.db != 0 {
		if _, err := redisDo(r, conn, "SELECT", strconv.Itoa(c.db)); err != nil {
			return nil, fmt.Errorf("select db %d: %w", c.db, err)
		}
	}
	return redisDo(r, conn, args...)
}

func (c *redisCache) ping(ctx context.Context) error {
	v, err := c.roundTrip(ctx, "PING")
	if err != nil {
		return err
	}
	if s, ok := v.(string); !ok || strings.ToUpper(s) != "PONG" {
		return fmt.Errorf("unexpected PING reply: %v", v)
	}
	return nil
}

func (c *redisCache) Get(ctx context.Context, key string) (string, bool) {
	if key == "" {
		return "", false
	}
	v, err := c.roundTrip(ctx, "GET", key)
	if err != nil {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

func (c *redisCache) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if key == "" {
		return fmt.Errorf("cache: empty key")
	}
	args := []string{"SET", key, value}
	if ttl > 0 {
		args = append(args, "PX", strconv.FormatInt(ttl.Milliseconds(), 10))
	}
	_, err := c.roundTrip(ctx, args...)
	return err
}

func (c *redisCache) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if key == "" {
		return fmt.Errorf("cache: empty key")
	}
	_, err := c.roundTrip(ctx, "DEL", key)
	return err
}

// redisDo writes one command in RESP2 inline-array form and reads one reply.
// Replies decode to string (simple/bulk), int64 (integer), or nil (null bulk).
func redisDo(r *bufio.Reader, conn net.Conn, args ...string) (any, error) {
	var sb strings.Builder
	sb.WriteString("*" + strconv.Itoa(len(args)) + "\r\n")
	for _, a := range args {
		sb.WriteString("$" + strconv.Itoa(len(a)) + "\r\n" + a + "\r\n")
	}
	if _, err := conn.Write([]byte(sb.String())); err != nil {
		return nil, err
	}
	return readReply(r)
}

func readReply(r *bufio.Reader) (any, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return nil, err
	}
	if len(line) < 3 { // type byte + payload + \r\n at minimum
		return nil, fmt.Errorf("redis: short reply %q", line)
	}
	typ, payload := line[0], strings.TrimSuffix(line[1:], "\r\n")

	switch typ {
	case '+': // simple string
		return payload, nil
	case '-': // error
		return nil, fmt.Errorf("redis: %s", payload)
	case ':': // integer
		n, err := strconv.ParseInt(payload, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("redis: bad integer %q", payload)
		}
		return n, nil
	case '$': // bulk string
		n, err := strconv.Atoi(payload)
		if err != nil {
			return nil, fmt.Errorf("redis: bad bulk length %q", payload)
		}
		if n == -1 {
			return nil, nil // key missing
		}
		buf := make([]byte, n+2) // value + trailing \r\n
		if _, err := readFull(r, buf); err != nil {
			return nil, err
		}
		return string(buf[:n]), nil
	default:
		return nil, fmt.Errorf("redis: unknown reply type %q", typ)
	}
}

func readFull(r *bufio.Reader, buf []byte) (int, error) {
	total := 0
	for total < len(buf) {
		n, err := r.Read(buf[total:])
		total += n
		if err != nil {
			return total, err
		}
	}
	return total, nil
}
