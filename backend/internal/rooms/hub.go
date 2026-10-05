package rooms

import (
	"encoding/json"
	"log"
	"sync"
	"time"
)

// Hub owns all rooms. The rooms map is guarded by mu; each Room runs
// exactly one goroutine (Room.run) that owns its client set and fans
// out broadcasts, so no slow client blocks control application.
type Hub struct {
	mu     sync.RWMutex
	rooms  map[string]*Room
	broker Broker

	stopReap chan struct{}
}

// NewHub builds a hub. Publish fan-out goes through broker (local
// no-op or RabbitMQ); pass nil to run fully local.
func NewHub(broker Broker) *Hub {
	if broker == nil {
		broker = LocalBroker{}
	}
	h := &Hub{
		rooms:    map[string]*Room{},
		broker:   broker,
		stopReap: make(chan struct{}),
	}
	go h.reapLoop()
	return h
}

// publish forwards one broadcast payload to the broker for other
// instances. Local failures never break the local fan-out.
func (h *Hub) publish(code string, payload []byte) {
	if err := h.broker.Publish(code, payload); err != nil {
		log.Printf("rooms: broker publish %s failed: %v", code, err)
	}
}

// SetBroker swaps the fan-out broker (used after the broker is built
// with Hub.Deliver as its inbound callback).
func (h *Hub) SetBroker(b Broker) {
	if b == nil {
		b = LocalBroker{}
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.broker = b
}

// Create makes a room with a fresh code and master key.
func (h *Hub) Create() (*Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if len(h.rooms) >= 1000 {
		return nil, errTooManyRooms
	}
	for range 8 {
		code, err := newRoomCode()
		if err != nil {
			return nil, err
		}
		if _, taken := h.rooms[code]; taken {
			continue
		}
		key, err := newMasterKey()
		if err != nil {
			return nil, err
		}
		r := newRoom(code, key, h.publish)
		h.rooms[code] = r
		go r.run()
		return r, nil
	}
	return nil, errTooManyRooms
}

// Get returns a room by code (case-insensitive, trimmed).
func (h *Hub) Get(code string) (*Room, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	r, ok := h.rooms[normalizeCode(code)]
	return r, ok
}

// Deliver injects a broker-received payload into the room's local
// fan-out only (publish=false: no republish loop).
func (h *Hub) Deliver(code string, payload []byte) {
	h.mu.RLock()
	r, ok := h.rooms[normalizeCode(code)]
	h.mu.RUnlock()
	if !ok || r == nil {
		return
	}
	select {
	case r.broadcast <- payload:
	default:
	}
}

// reapLoop drops rooms that stayed empty past emptyRoomTTL.
func (h *Hub) reapLoop() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			h.reap()
		case <-h.stopReap:
			return
		}
	}
}

func (h *Hub) reap() {
	now := time.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	for code, r := range h.rooms {
		r.mu.Lock()
		empty := len(r.clients) == 0 && len(r.members) == 0
		idle := now.Sub(r.lastActive) > emptyRoomTTL
		r.mu.Unlock()
		if empty && idle {
			delete(h.rooms, code)
		}
	}
}

// run is the room goroutine: owns r.clients, fans out broadcasts.
func (r *Room) run() {
	tick := time.NewTicker(stateTickInterval)
	defer tick.Stop()
	for {
		select {
		case c := <-r.register:
			r.mu.Lock()
			r.clients[c] = struct{}{}
			r.mu.Unlock()
		case c := <-r.unregister:
			r.mu.Lock()
			if _, ok := r.clients[c]; ok {
				delete(r.clients, c)
				close(c.send)
			}
			r.mu.Unlock()
		case msg := <-r.broadcast:
			r.mu.Lock()
			for c := range r.clients {
				select {
				case c.send <- msg:
				default:
					// Slow client: drop instead of blocking the room.
					delete(r.clients, c)
					close(c.send)
				}
			}
			r.mu.Unlock()
		case <-tick.C:
			r.mu.Lock()
			hasClients := len(r.clients) > 0
			sync := r.stateSyncLocked()
			r.mu.Unlock()
			if !hasClients {
				continue
			}
			raw, err := json.Marshal(sync)
			if err != nil {
				continue
			}
			r.mu.Lock()
			for c := range r.clients {
				select {
				case c.send <- raw:
				default:
					delete(r.clients, c)
					close(c.send)
				}
			}
			r.mu.Unlock()
		}
	}
}

// emit marshals v and fans out locally plus publishes to the broker.
// Callers: room goroutine excluded — emit is safe from any goroutine
// because broadcast is a channel and publish is broker-guarded.
func (r *Room) emit(v any) {
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case r.broadcast <- raw:
	default:
	}
	if r.publish != nil {
		r.publish(r.Code, raw)
	}
}

func normalizeCode(code string) string {
	out := make([]byte, 0, len(code))
	for i := 0; i < len(code); i++ {
		c := code[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			out = append(out, c)
		}
	}
	return string(out)
}
