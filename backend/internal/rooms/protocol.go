package rooms

// Wire protocol for watch-together rooms. Field names use snake_case and
// every envelope carries a `type` discriminator. This file mirrors
// proto/rooms.ws.json — update both in the same change.
//
// Client -> server: join, control, chat, permission, loop.
// Server -> clients: joined, state_sync, members, chat, history, notice, error.

const (
	// Client -> server.
	MsgJoin       = "join"
	MsgControl    = "control"
	MsgChat       = "chat"
	MsgPermission = "permission"
	MsgLoop       = "loop"

	// Server -> clients.
	MsgJoined    = "joined"
	MsgStateSync = "state_sync"
	MsgMembers   = "members"
	MsgHistory   = "history"
	MsgNotice    = "notice"
	MsgError     = "error"
)

// Control actions (client -> server, inside MsgControl).
const (
	ActionPlay        = "play"
	ActionPause       = "pause"
	ActionSeek        = "seek"
	ActionChangeVideo = "change_video"
)

// Video types carried in state_sync.
const (
	VideoDirect  = "direct"
	VideoYouTube = "youtube"
	VideoEmbed   = "embed"
	VideoNone    = "none"
)

// Envelope is the outer frame of every WS message.
type Envelope struct {
	Type string `json:"type"`
}

// JoinMsg is sent by the client right after the WS upgrade.
type JoinMsg struct {
	Type      string `json:"type"`
	Username  string `json:"username"`
	MasterKey string `json:"master_key,omitempty"`
}

// ControlMsg requests a playback change. PositionMs is the sender's
// current position; for change_video VideoURL is required.
type ControlMsg struct {
	Type        string `json:"type"`
	Action      string `json:"action"`
	VideoURL    string `json:"video_url,omitempty"`
	PositionMs  int64  `json:"position_ms,omitempty"`
	ClientMsgID string `json:"client_msg_id,omitempty"`
}

// PermissionMsg toggles whether every member may control playback.
// Master only.
type PermissionMsg struct {
	Type            string `json:"type"`
	AllowAllControl bool   `json:"allow_all_control"`
	ClientMsgID     string `json:"client_msg_id,omitempty"`
}

// LoopMsg toggles room video looping. Master only. When enabled, the
// master's player restarts the room on ended via an ordinary play
// control at position_ms=0 (never a local <video> loop, which would
// desync the drift corrector).
type LoopMsg struct {
	Type        string `json:"type"`
	LoopEnabled bool   `json:"loop_enabled"`
	ClientMsgID string `json:"client_msg_id,omitempty"`
}

// ChatIn is a client chat message.
type ChatIn struct {
	Type        string `json:"type"`
	Text        string `json:"text"`
	ClientMsgID string `json:"client_msg_id,omitempty"`
}

// JoinedMsg confirms the join with the assigned (deduped) username and
// whether this client holds master rights.
type JoinedMsg struct {
	Type     string `json:"type"`
	Username string `json:"username"`
	IsMaster bool   `json:"is_master"`
}

// Member is one room occupant.
type Member struct {
	Username string `json:"username"`
	IsMaster bool   `json:"is_master"`
}

// StateSyncMsg is the authoritative playback state. Clients derive
// current position as position_ms + elapsed-since updated_at when
// playing is true; the <video>/YT player is a view, never the source.
// Generic embeds (<iframe>) cannot be driven at all: state is informational.
type StateSyncMsg struct {
	Type      string `json:"type"`
	VideoURL  string `json:"video_url"`
	VideoType string `json:"video_type"`
	VideoID   string `json:"video_id,omitempty"`
	// AllowAll mirrors the room permission toggle so every client can
	// render controls enabled/disabled without extra round-trips.
	AllowAll bool `json:"allow_all"`
	// LoopEnabled mirrors the room loop toggle (master restarts the
	// room at position 0 when its player ends).
	LoopEnabled bool   `json:"loop_enabled"`
	PositionMs  int64  `json:"position_ms"`
	Playing     bool   `json:"playing"`
	UpdatedAt   int64  `json:"updated_at"`
	Version     uint64 `json:"version"`
}

// ChatMsg is a broadcast chat line stamped with server time.
type ChatMsg struct {
	Type     string `json:"type"`
	Username string `json:"username"`
	Text     string `json:"text"`
	At       int64  `json:"at"`
	Seq      uint64 `json:"seq"`
}

// NoticeMsg announces room events (master transfer, member join/leave,
// rejected control) to every member.
type NoticeMsg struct {
	Type string `json:"type"`
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// ErrorMsg is delivered to the sender only.
type ErrorMsg struct {
	Type string `json:"type"`
	Code string `json:"code"`
	Text string `json:"text"`
}
