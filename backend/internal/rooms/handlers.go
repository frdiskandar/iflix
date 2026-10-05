package rooms

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// Server wires rooms HTTP + WS routes onto a mux.
type Server struct {
	hub      *Hub
	upgrader websocket.Upgrader
	video    string // path to the default video file
}

// NewServer builds routes state. Video defaults to
// backend/default-video.mp4, overridable via DEFAULT_VIDEO_PATH.
func NewServer(hub *Hub) *Server {
	video := strings.TrimSpace(os.Getenv("DEFAULT_VIDEO_PATH"))
	if video == "" {
		video = "default-video.mp4"
	}
	return &Server{
		hub: hub,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  8192,
			WriteBufferSize: 8192,
			CheckOrigin:     checkOrigin,
		},
		video: video,
	}
}

// RegisterRoutes mounts room endpoints.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/rooms", s.handleCreate)
	mux.HandleFunc("GET /api/v1/rooms/{code}", s.handleInfo)
	mux.HandleFunc("GET /ws/rooms/{code}", s.handleWS)
	mux.HandleFunc("GET /default-video.mp4", s.handleDefaultVideo)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, text string) {
	writeJSON(w, status, map[string]string{"error": text, "code": code})
}

// handleCreate mints a room. Body: {"username":"..."}. The caller is
// expected to WS-join with the returned master_key to claim master.
func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_body", "Username wajib diisi.")
		return
	}
	if strings.TrimSpace(body.Username) == "" {
		writeErr(w, http.StatusBadRequest, "bad_username", "Username wajib diisi.")
		return
	}
	room, err := s.hub.Create()
	if err != nil {
		writeErr(w, http.StatusServiceUnavailable, "busy", "Server penuh, coba lagi.")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{
		"room_code":  room.Code,
		"master_key": room.MasterKey,
	})
}

// handleInfo returns join metadata for a room code.
func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	room, ok := s.hub.Get(r.PathValue("code"))
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "Room tidak ditemukan.")
		return
	}
	room.mu.Lock()
	members := room.membersLocked()
	state := room.stateSyncLocked()
	allowAll := room.allowAll
	master := room.master
	room.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"room_code":  room.Code,
		"members":    len(members),
		"has_video":  state.VideoURL != "",
		"video_type": state.VideoType,
		"allow_all":  allowAll,
		"master":     master,
		"created_at": room.CreatedAt.Format(time.RFC3339),
	})
}

// handleWS upgrades to the room socket. Query: ?username=&master_key=.
// Room existence and username are validated before the upgrade.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	room, ok := s.hub.Get(r.PathValue("code"))
	if !ok {
		writeErr(w, http.StatusNotFound, "not_found", "Room tidak ditemukan.")
		return
	}
	username := strings.TrimSpace(r.URL.Query().Get("username"))
	if username == "" || len([]rune(username)) > maxUsernameLen {
		writeErr(w, http.StatusBadRequest, "bad_username", "Username 1-20 karakter wajib diisi.")
		return
	}
	masterKey := strings.TrimSpace(r.URL.Query().Get("master_key"))

	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("rooms: ws upgrade %s from %s origin=%q failed: %v", r.URL.Path, r.RemoteAddr, r.Header.Get("Origin"), err)
		return
	}
	log.Printf("rooms: ws open %s user=%q from %s", r.URL.Path, username, r.RemoteAddr)

	name, isMaster, members := room.join(username, masterKey)
	c := &Client{room: room, conn: conn, username: name, isMaster: isMaster, send: make(chan []byte, 32)}
	room.register <- c

	// Catch the newcomer up: identity, presence, state, history.
	mustSend := func(v any) {
		raw, err := json.Marshal(v)
		if err != nil {
			return
		}
		c.send <- raw
	}
	mustSend(JoinedMsg{Type: MsgJoined, Username: name, IsMaster: isMaster})
	mustSend(map[string]any{"type": MsgMembers, "members": members})
	mustSend(room.currentSync())
	_, _, history := room.snapshotLocked()
	mustSend(map[string]any{"type": MsgHistory, "messages": history})
	room.emitMembers()
	room.emit(NoticeMsg{Type: MsgNotice, Kind: "join", Text: name + " bergabung."})

	go c.writePump()
	c.readPump() // blocks until disconnect

	// Disconnect: leave + presence + possible master transfer.
	// (readPump already queued unregister; the run loop ignores dupes.)
	newMaster, transferred := room.leave(name)
	room.unregister <- c
	if transferred && newMaster != "" {
		room.emit(NoticeMsg{Type: MsgNotice, Kind: "master", Text: newMaster + " menjadi master room."})
	}
	room.emit(NoticeMsg{Type: MsgNotice, Kind: "leave", Text: name + " keluar."})
	room.emitMembers()
}

// emitMembers broadcasts the current presence list.
func (r *Room) emitMembers() {
	r.mu.Lock()
	members := r.membersLocked()
	r.mu.Unlock()
	r.emit(map[string]any{"type": MsgMembers, "members": members})
}

// handleDefaultVideo serves the bundled default video with range
// support (seekable). Missing file -> 404 JSON.
func (s *Server) handleDefaultVideo(w http.ResponseWriter, r *http.Request) {
	f, err := os.Open(s.video)
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "Default video belum tersedia.")
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		writeErr(w, http.StatusNotFound, "not_found", "Default video belum tersedia.")
		return
	}
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, "default-video.mp4", fi.ModTime(), f)
}

// checkOrigin allows same-origin/non-browser callers, any loopback
// origin (localhost/127.0.0.1/::1, any port: dev servers move ports),
// and private-LAN origins (phone/laptop testing via --host), plus
// FRONTEND_ORIGIN overrides (comma-separated) for deployments.
// Foreign public origins stay rejected. Rooms carry no credentials,
// so the blast radius of a LAN origin is joining/chatting as yourself.
func checkOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	host := originHost(strings.ToLower(origin))
	if host == "" {
		return false
	}
	if host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1" {
		return true
	}
	if isPrivateIP(host) {
		return true
	}
	if v := strings.TrimSpace(os.Getenv("FRONTEND_ORIGIN")); v != "" {
		for _, o := range strings.Split(v, ",") {
			if strings.TrimSpace(o) == origin {
				return true
			}
		}
	}
	return false
}

// originHost extracts the host part of an http(s) origin URL.
func originHost(origin string) string {
	s := strings.TrimPrefix(origin, "https://")
	s = strings.TrimPrefix(s, "http://")
	if i := strings.Index(s, "/"); i >= 0 {
		s = s[:i]
	}
	if h := strings.TrimSuffix(strings.TrimPrefix(s, "["), "]"); strings.Count(s, ":") > 1 {
		return "[" + h + "]" // bare IPv6 literal
	}
	if i := strings.LastIndex(s, ":"); i >= 0 {
		s = s[:i]
	}
	return s
}

// isPrivateIP reports RFC1918 private IPv4 ranges (10/8, 172.16/12,
// 192.168/16) for LAN-device development.
func isPrivateIP(host string) bool {
	var a, b, c, d int
	if _, err := fmtSscanf(host, &a, &b, &c, &d); err != nil {
		return false
	}
	switch {
	case a == 10:
		return true
	case a == 172 && b >= 16 && b <= 31:
		return true
	case a == 192 && b == 168:
		return true
	}
	return false
}

// fmtSscanf parses dotted-quad IPv4 without importing net/url here.
var errBadIP = errors.New("bad ip")

func fmtSscanf(host string, a, b, c, d *int) (int, error) {
	parts := strings.Split(host, ".")
	if len(parts) != 4 {
		return 0, errBadIP
	}
	nums := make([]int, 4)
	for i, p := range parts {
		n := 0
		if p == "" {
			return 0, errBadIP
		}
		for _, r := range p {
			if r < '0' || r > '9' {
				return 0, errBadIP
			}
			n = n*10 + int(r-'0')
			if n > 255 {
				return 0, errBadIP
			}
		}
		nums[i] = n
	}
	*a, *b, *c, *d = nums[0], nums[1], nums[2], nums[3]
	return 4, nil
}
