package rooms

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func testRoom() *Room {
	return newRoom("ABCDEF", "masterkey123", nil)
}

func TestRoomCodeFormat(t *testing.T) {
	seen := map[string]bool{}
	for range 200 {
		code, err := newRoomCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != 6 {
			t.Fatalf("code len = %d, want 6", len(code))
		}
		for _, c := range code {
			if !strings.ContainsRune(roomCodeAlphabet, c) {
				t.Fatalf("code %q has out-of-alphabet rune %q", code, c)
			}
		}
		seen[code] = true
	}
	if len(seen) < 190 {
		t.Fatalf("only %d unique codes in 200 draws, want ~200", len(seen))
	}
}

func TestFirstJoinBecomesMaster(t *testing.T) {
	r := testRoom()
	name, master, _ := r.join("alice", "")
	if name != "alice" || !master {
		t.Fatalf("join = (%q, %v), want (alice, true)", name, master)
	}
	name2, master2, members := r.join("bob", "")
	if name2 != "bob" || master2 {
		t.Fatalf("second join = (%q, %v), want (bob, false)", name2, master2)
	}
	if len(members) != 2 {
		t.Fatalf("members = %d, want 2", len(members))
	}
}

func TestDuplicateNameDeduped(t *testing.T) {
	r := testRoom()
	r.join("alice", "")
	name, _, _ := r.join("alice", "")
	if name != "alice-2" {
		t.Fatalf("dup join = %q, want alice-2", name)
	}
}

func TestMasterKeyReclaim(t *testing.T) {
	r := testRoom()
	r.join("alice", "")
	name, master, _ := r.join("mallory", "masterkey123")
	if name != "mallory" || !master {
		t.Fatalf("reclaim = (%q, %v), want (mallory, true)", name, master)
	}
}

func TestMasterTransferOnLeave(t *testing.T) {
	r := testRoom()
	r.join("alice", "")
	r.join("bob", "")
	r.join("carol", "")
	newMaster, transferred := r.leave("alice")
	if !transferred || newMaster != "bob" {
		t.Fatalf("transfer = (%q, %v), want (bob, true)", newMaster, transferred)
	}
}

func TestControlGating(t *testing.T) {
	r := testRoom()
	r.join("alice", "")
	r.join("bob", "")
	now := time.Now()

	if _, ok, _ := r.applyControl("bob", ControlMsg{Type: MsgControl, Action: ActionPlay}, now); ok {
		t.Fatal("non-master control accepted while locked")
	}
	if _, ok, code := r.applyControl("alice", ControlMsg{Type: MsgControl, Action: "dance"}, now); ok || code != "bad_action" {
		t.Fatalf("bad action = (%v, %q), want (false, bad_action)", ok, code)
	}
	sync, ok, _ := r.applyControl("alice", ControlMsg{Type: MsgControl, Action: ActionPlay, PositionMs: 1000}, now)
	if !ok || !sync.Playing || sync.Version != 1 {
		t.Fatalf("play = %+v, ok=%v", sync, ok)
	}

	if ok, _ := r.applyPermission("bob", true); ok {
		t.Fatal("non-master permission change accepted")
	}
	if ok, _ := r.applyPermission("alice", true); !ok {
		t.Fatal("master permission change rejected")
	}
	if _, ok, _ := r.applyControl("bob", ControlMsg{Type: MsgControl, Action: ActionPause, PositionMs: 2000}, now); !ok {
		t.Fatal("member control rejected after allow-all")
	}
	st := r.currentSync()
	if st.Playing || st.PositionMs != 2000 || st.Version != 2 {
		t.Fatalf("state = %+v, want paused@2000 v2", st)
	}
}

func TestChangeVideoResetsPosition(t *testing.T) {
	r := testRoom()
	r.join("alice", "")
	now := time.Now()
	sync, ok, _ := r.applyControl("alice", ControlMsg{
		Type: MsgControl, Action: ActionChangeVideo,
		VideoURL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
	}, now)
	if !ok {
		t.Fatal("change_video rejected")
	}
	if sync.VideoType != VideoYouTube || sync.VideoID != "dQw4w9WgXcQ" {
		t.Fatalf("classify = (%q, %q)", sync.VideoType, sync.VideoID)
	}
	if sync.PositionMs != 0 || !sync.Playing || sync.Version != 1 {
		t.Fatalf("sync = %+v", sync)
	}
	if _, ok, code := r.applyControl("alice", ControlMsg{Type: MsgControl, Action: ActionChangeVideo}, now); ok || code != "bad_video_url" {
		t.Fatalf("empty url = (%v, %q)", ok, code)
	}
}

func TestChatCap50(t *testing.T) {
	r := testRoom()
	now := time.Now()
	for i := range 60 {
		if _, ok := r.addChat("alice", "msg", now); !ok {
			t.Fatal("chat rejected")
		}
		_ = i
	}
	_, _, history := r.snapshotLocked()
	if len(history) != 50 {
		t.Fatalf("history len = %d, want 50", len(history))
	}
	if history[0].Seq != 11 || history[49].Seq != 60 {
		t.Fatalf("seq range = %d..%d, want 11..60", history[0].Seq, history[49].Seq)
	}
	if _, ok := r.addChat("alice", "   ", now); ok {
		t.Fatal("blank chat accepted")
	}
}

func TestYoutubeIDForms(t *testing.T) {
	cases := map[string]string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ":       "dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ":                      "dQw4w9WgXcQ",
		"https://www.youtube.com/embed/dQw4w9WgXcQ":         "dQw4w9WgXcQ",
		"https://www.youtube.com/shorts/dQw4w9WgXcQ?x=1":    "dQw4w9WgXcQ",
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s": "dQw4w9WgXcQ",
		"https://example.com/video.mp4":                     "",
		"not a url":                                         "",
	}
	for in, want := range cases {
		if got := youtubeID(in); got != want {
			t.Fatalf("youtubeID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMarkSeenIdempotent(t *testing.T) {
	r := testRoom()
	if r.markSeen("a") {
		t.Fatal("first sighting reported dup")
	}
	if !r.markSeen("a") {
		t.Fatal("second sighting not reported dup")
	}
	if r.markSeen("") {
		t.Fatal("empty id reported dup")
	}
}

func TestBrokerFallbackLocal(t *testing.T) {
	t.Setenv("RABBITMQ_URL", "")
	b := NewBrokerFromEnv(nil)
	if b == nil {
		t.Fatal("broker is nil")
	}
	if b.Backend() != "local" {
		t.Fatalf("backend = %q, want local", b.Backend())
	}
	b.Close()
}

func TestBrokerBadURLFallsBack(t *testing.T) {
	t.Setenv("RABBITMQ_URL", "amqp://127.0.0.1:1/")
	b := NewBrokerFromEnv(nil)
	if b.Backend() != "local" {
		t.Fatalf("backend = %q, want local fallback", b.Backend())
	}
	b.Close()
}

func TestHubCreateGet(t *testing.T) {
	h := NewHub(nil)
	r, err := h.Create()
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Code) != 6 || r.MasterKey == "" {
		t.Fatalf("room = %+v", r)
	}
	got, ok := h.Get("  " + strings.ToLower(r.Code) + " ")
	if !ok || got != r {
		t.Fatal("Get with messy code failed")
	}
	if _, ok := h.Get("ZZZZZZ"); ok {
		t.Fatal("Get unknown code succeeded")
	}
}

func TestHubDeliverUnknownRoomDrops(t *testing.T) {
	h := NewHub(nil)
	h.Deliver("NOPE", []byte(`{}`)) // must not panic
}

func TestCheckOriginLoopback(t *testing.T) {
	for _, origin := range []string{
		"",
		"http://localhost:5173",
		"http://localhost:8080",
		"http://127.0.0.1:5173",
		"http://127.0.0.1:80",
		"http://192.168.1.10:5173",
		"http://10.0.0.5:5173",
		"http://172.20.3.9:5173",
	} {
		r, _ := http.NewRequest("GET", "/", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if !checkOrigin(r) {
			t.Fatalf("origin %q rejected, want allow", origin)
		}
	}
	for _, origin := range []string{
		"https://evil.example.com",
		"http://localhost.evil.com",
		"http://172.32.0.1:5173",
		"http://192.167.1.1:5173",
		"not-a-url",
	} {
		r, _ := http.NewRequest("GET", "/", nil)
		r.Header.Set("Origin", origin)
		if checkOrigin(r) {
			t.Fatalf("origin %q allowed, want reject", origin)
		}
	}
}
