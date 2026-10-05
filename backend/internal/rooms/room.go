package rooms

import (
	"crypto/rand"
	"strings"
	"sync"
	"time"
)

const (
	// roomCodeLen is the length of user-facing room codes.
	roomCodeLen = 6
	// roomCodeAlphabet avoids ambiguous glyphs (0/O, 1/I/L).
	roomCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	// masterKeyBytes is the entropy of the creator reclaim secret.
	masterKeyBytes = 16
	// chatHistoryCap bounds per-room chat memory (no persistence).
	chatHistoryCap = 50
	// maxChatLen caps one chat line.
	maxChatLen = 500
	// maxUsernameLen caps usernames.
	maxUsernameLen = 20
	// emptyRoomTTL reaps rooms with zero members.
	emptyRoomTTL = 30 * time.Minute
	// stateTickInterval rebroadcasts state_sync so late/jittered
	// clients converge without waiting for the next control.
	stateTickInterval = 5 * time.Second
)

// PlaybackState is the authoritative per-room playback state.
// The backend owns it: video identity, position, playing flag and a
// monotonic version. Conflicts resolve last-writer-wins on arrival
// order inside the room goroutine (ties broken by server time:
// UpdatedAt is stamped at apply time).
type PlaybackState struct {
	VideoURL   string
	VideoType  string
	VideoID    string
	PositionMs int64
	Playing    bool
	UpdatedAt  int64 // server unix millis
	Version    uint64
}

// Room is one watch-together session. State fields are guarded by mu;
// fan-out to clients happens in the room goroutine via channels so no
// slow client can block control application.
type Room struct {
	Code      string
	MasterKey string
	CreatedAt time.Time

	mu         sync.Mutex
	master     string
	allowAll   bool
	state      PlaybackState
	members    []string // join order; first non-master is transfer target
	chat       []ChatMsg
	chatSeq    uint64
	seenMsgIDs map[string]struct{}
	lastActive time.Time
	clients    map[*Client]struct{}
	register   chan *Client
	unregister chan *Client
	broadcast  chan []byte
	publish    func(code string, payload []byte)
}

func newRoom(code, masterKey string, publish func(code string, payload []byte)) *Room {
	return &Room{
		Code:       code,
		MasterKey:  masterKey,
		CreatedAt:  time.Now(),
		state:      PlaybackState{VideoType: VideoNone},
		seenMsgIDs: map[string]struct{}{},
		lastActive: time.Now(),
		clients:    map[*Client]struct{}{},
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 64),
		publish:    publish,
	}
}

// touchLocked refreshes activity. Caller must hold mu.
func (r *Room) touchLocked() {
	r.lastActive = time.Now()
}

// isMasterLocked reports mastership. Caller must hold mu.
func (r *Room) isMasterLocked(username string) bool {
	return username != "" && username == r.master
}

// canControlLocked reports whether username may issue controls.
// Caller must hold mu.
func (r *Room) canControlLocked(username string) bool {
	return r.allowAll || r.isMasterLocked(username)
}

// join assigns a deduped username, grants master to the first member
// (or to a valid masterKey holder via reclaim), and returns the
// assigned name, mastership and the current member list.
func (r *Room) join(username, masterKey string) (string, bool, []Member) {
	r.mu.Lock()
	defer r.mu.Unlock()

	name := dedupeName(username, r.members)
	if r.master == "" {
		r.master = name
	} else if masterKey != "" && masterKey == r.MasterKey && name != r.master {
		r.master = name
	}
	r.members = append(r.members, name)
	r.touchLocked()
	return name, r.isMasterLocked(name), r.membersLocked()
}

// leave removes a member; mastership transfers to the oldest remaining
// member. It returns the new master ("") when nobody remains.
func (r *Room) leave(username string) (newMaster string, transferred bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for i, m := range r.members {
		if m == username {
			r.members = append(r.members[:i], r.members[i+1:]...)
			break
		}
	}
	r.touchLocked()
	if r.master == username {
		if len(r.members) > 0 {
			r.master = r.members[0]
			return r.master, true
		}
		r.master = ""
		return "", true
	}
	return "", false
}

// membersLocked builds the presence list. Caller must hold mu.
func (r *Room) membersLocked() []Member {
	out := make([]Member, 0, len(r.members))
	for _, m := range r.members {
		out = append(out, Member{Username: m, IsMaster: m == r.master})
	}
	return out
}

// snapshotLocked copies public room info. Caller must hold mu.
func (r *Room) snapshotLocked() (PlaybackState, []Member, []ChatMsg) {
	chat := make([]ChatMsg, len(r.chat))
	copy(chat, r.chat)
	return r.state, r.membersLocked(), chat
}

// applyControl validates and applies a control message from username.
// It returns accepted=false with a machine-readable code when the
// sender lacks rights. Every accepted change bumps Version and stamps
// UpdatedAt with server time (last-writer-wins by arrival order).
func (r *Room) applyControl(username string, msg ControlMsg, now time.Time) (StateSyncMsg, bool, string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.canControlLocked(username) {
		return StateSyncMsg{}, false, "forbidden"
	}

	switch msg.Action {
	case ActionPlay:
		r.state.Playing = true
		r.state.PositionMs = clampPosition(msg.PositionMs)
	case ActionPause:
		r.state.PositionMs = clampPosition(msg.PositionMs)
		r.state.Playing = false
	case ActionSeek:
		r.state.PositionMs = clampPosition(msg.PositionMs)
	case ActionChangeVideo:
		url := strings.TrimSpace(msg.VideoURL)
		if url == "" {
			return StateSyncMsg{}, false, "bad_video_url"
		}
		r.state.VideoURL = url
		r.state.VideoType, r.state.VideoID = classifyVideo(url)
		r.state.PositionMs = 0
		r.state.Playing = true
	default:
		return StateSyncMsg{}, false, "bad_action"
	}

	r.state.Version++
	r.state.UpdatedAt = now.UnixMilli()
	r.touchLocked()
	return r.stateSyncLocked(), true, ""
}

// applyPermission flips the allow-all toggle. Master only.
func (r *Room) applyPermission(username string, allow bool) (bool, string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if !r.isMasterLocked(username) {
		return false, "forbidden"
	}
	r.allowAll = allow
	r.touchLocked()
	return true, ""
}

// addChat appends a chat line, stamping server time and a sequence
// number, keeping only the newest chatHistoryCap lines.
func (r *Room) addChat(username, text string, now time.Time) (ChatMsg, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	text = strings.TrimSpace(text)
	if text == "" {
		return ChatMsg{}, false
	}
	if len([]rune(text)) > maxChatLen {
		text = string([]rune(text)[:maxChatLen])
	}
	r.chatSeq++
	m := ChatMsg{Type: MsgChat, Username: username, Text: text, At: now.UnixMilli(), Seq: r.chatSeq}
	r.chat = append(r.chat, m)
	if len(r.chat) > chatHistoryCap {
		r.chat = r.chat[len(r.chat)-chatHistoryCap:]
	}
	r.touchLocked()
	return m, true
}

// markSeen records a client message id for idempotency (echo/retry
// suppression). Empty ids are never deduped. Returns true on duplicate.
func (r *Room) markSeen(id string) bool {
	if id == "" {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.seenMsgIDs[id]; dup {
		return true
	}
	r.seenMsgIDs[id] = struct{}{}
	// Bound memory: keep only recent ids.
	if len(r.seenMsgIDs) > 512 {
		r.seenMsgIDs = map[string]struct{}{id: {}}
	}
	return false
}

// currentSync returns a copy of the current authoritative state.
func (r *Room) currentSync() StateSyncMsg {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.stateSyncLocked()
}

// stateSyncLocked builds the authoritative broadcast. Caller must hold mu.
func (r *Room) stateSyncLocked() StateSyncMsg {
	return StateSyncMsg{
		Type:       MsgStateSync,
		VideoURL:   r.state.VideoURL,
		VideoType:  r.state.VideoType,
		VideoID:    r.state.VideoID,
		AllowAll:   r.allowAll,
		PositionMs: r.state.PositionMs,
		Playing:    r.state.Playing,
		UpdatedAt:  r.state.UpdatedAt,
		Version:    r.state.Version,
	}
}

// dedupeName appends -2, -3, ... until the name is unique in the room.
func dedupeName(want string, taken []string) string {
	want = strings.TrimSpace(want)
	if want == "" {
		want = "guest"
	}
	if len([]rune(want)) > maxUsernameLen {
		want = string([]rune(want)[:maxUsernameLen])
	}
	has := func(n string) bool {
		for _, m := range taken {
			if m == n {
				return true
			}
		}
		return false
	}
	if !has(want) {
		return want
	}
	for i := 2; ; i++ {
		cand := strings.TrimSpace(want + "-" + itoa(i))
		if !has(cand) {
			return cand
		}
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [8]byte
	p := len(b)
	for i > 0 {
		p--
		b[p] = byte('0' + i%10)
		i /= 10
	}
	return string(b[p:])
}

func clampPosition(ms int64) int64 {
	if ms < 0 {
		return 0
	}
	return ms
}

// classifyVideo maps a user-supplied link to a player type.
// YouTube watch/share/embed URLs become youtube+id; anything else is a
// direct video URL handed to <video>.
func classifyVideo(raw string) (typ, id string) {
	if v := strings.TrimSpace(raw); v != "" {
		if vid := youtubeID(v); vid != "" {
			return VideoYouTube, vid
		}
		return VideoDirect, raw
	}
	return VideoNone, ""
}

// youtubeID extracts the 11-char video id from common YouTube URL forms.
func youtubeID(raw string) string {
	s := strings.TrimSpace(raw)
	lower := strings.ToLower(s)
	candidates := []string{}
	switch {
	case strings.Contains(lower, "youtube.com/watch"):
		candidates = append(candidates, queryParam(s, "v"))
	case strings.Contains(lower, "youtu.be/"):
		if i := strings.Index(lower, "youtu.be/"); i >= 0 {
			candidates = append(candidates, s[i+len("youtu.be/"):])
		}
	case strings.Contains(lower, "youtube.com/embed/"):
		if i := strings.Index(lower, "youtube.com/embed/"); i >= 0 {
			candidates = append(candidates, s[i+len("youtube.com/embed/"):])
		}
	case strings.Contains(lower, "youtube.com/shorts/"):
		if i := strings.Index(lower, "youtube.com/shorts/"); i >= 0 {
			candidates = append(candidates, s[i+len("youtube.com/shorts/"):])
		}
	}
	for _, c := range candidates {
		c = strings.SplitN(c, "?", 2)[0]
		c = strings.SplitN(c, "&", 2)[0]
		c = strings.SplitN(c, "/", 2)[0]
		if len(c) == 11 {
			return c
		}
	}
	return ""
}

// queryParam pulls one query value without net/url (stdlib-light file).
func queryParam(raw, key string) string {
	q := raw
	if i := strings.Index(q, "?"); i >= 0 {
		q = q[i+1:]
	}
	if i := strings.Index(q, "#"); i >= 0 {
		q = q[:i]
	}
	for _, part := range strings.Split(q, "&") {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) == 2 && kv[0] == key {
			return kv[1]
		}
	}
	return ""
}

// newRoomCode draws a 6-char code from the unambiguous alphabet.
func newRoomCode() (string, error) {
	b := make([]byte, roomCodeLen)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = roomCodeAlphabet[int(b[i])%len(roomCodeAlphabet)]
	}
	return string(b), nil
}

// newMasterKey draws the creator reclaim secret (hex).
func newMasterKey() (string, error) {
	b := make([]byte, masterKeyBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	const hexd = "0123456789abcdef"
	out := make([]byte, 0, masterKeyBytes*2)
	for _, v := range b {
		out = append(out, hexd[v>>4], hexd[v&0x0f])
	}
	return string(out), nil
}
