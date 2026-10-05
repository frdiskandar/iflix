package rooms

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// wsWriteTimeout bounds one client write.
	wsWriteTimeout = 10 * time.Second
	// wsPongWait is the read deadline extended by every pong.
	wsPongWait = 60 * time.Second
	// wsPingPeriod keeps NAT/proxies alive (must be < pongWait).
	wsPingPeriod = 30 * time.Second
	// wsMaxMessage caps inbound frames (chat/control are tiny).
	wsMaxMessage = 8 << 10 // 8 KiB
)

// Client is one WS connection in a room.
type Client struct {
	room     *Room
	conn     *websocket.Conn
	username string
	isMaster bool
	send     chan []byte
}

func (c *Client) readPump() {
	defer func() {
		c.room.unregister <- c
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(wsMaxMessage)
	_ = c.conn.SetReadDeadline(time.Now().Add(wsPongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(wsPongWait))
		return nil
	})
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			log.Printf("rooms: ws close user=%q reason=%v", c.username, err)
			return
		}
		c.handle(raw)
	}
}

func (c *Client) writePump() {
	tick := time.NewTicker(wsPingPeriod)
	defer func() {
		tick.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-tick.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// handle dispatches one inbound frame. Control/permission failures go
// back to the sender only; accepted changes and chat fan out to all.
func (c *Client) handle(raw []byte) {
	var env Envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		c.sendError("bad_message", "Pesan tidak dikenali.")
		return
	}
	now := time.Now()
	switch env.Type {
	case MsgJoin:
		// Join is handled once at upgrade; late duplicates are ignored.
	case MsgControl:
		var m ControlMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			c.sendError("bad_message", "Kontrol tidak valid.")
			return
		}
		if dup := c.room.markSeen(m.ClientMsgID); dup {
			return
		}
		log.Printf("rooms: control user=%q action=%q room=%s", c.username, m.Action, c.room.Code)
		sync, ok, code := c.room.applyControl(c.username, m, now)
		if !ok {
			c.sendError(code, controlErrorText(code))
			return
		}
		c.room.emit(sync)
	case MsgPermission:
		var m PermissionMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			c.sendError("bad_message", "Izin tidak valid.")
			return
		}
		log.Printf("rooms: permission user=%q allow=%v room=%s", c.username, m.AllowAllControl, c.room.Code)
		ok, code := c.room.applyPermission(c.username, m.AllowAllControl)
		if !ok {
			c.sendError(code, "Hanya master room yang boleh mengubah izin.")
			return
		}
		c.room.emit(NoticeMsg{Type: MsgNotice, Kind: "permission", Text: permissionText(m.AllowAllControl)})
		// Emit a fresh full state so everyone converges on the toggle.
		c.room.emit(c.room.currentSync())
	case MsgChat:
		var m ChatIn
		if err := json.Unmarshal(raw, &m); err != nil {
			c.sendError("bad_message", "Chat tidak valid.")
			return
		}
		if dup := c.room.markSeen(m.ClientMsgID); dup {
			return
		}
		log.Printf("rooms: chat user=%q room=%s len=%d", c.username, c.room.Code, len(m.Text))
		chat, ok := c.room.addChat(c.username, m.Text, now)
		if !ok {
			return
		}
		c.room.emit(chat)
	default:
		c.sendError("bad_message", "Tipe pesan tidak dikenal.")
	}
}

func (c *Client) sendError(code, text string) {
	raw, err := json.Marshal(ErrorMsg{Type: MsgError, Code: code, Text: text})
	if err != nil {
		return
	}
	select {
	case c.send <- raw:
	default:
	}
}

func controlErrorText(code string) string {
	switch code {
	case "forbidden":
		return "Hanya master room yang boleh mengontrol. Minta master mengaktifkan izin semua user."
	case "bad_video_url":
		return "Link video kosong."
	default:
		return "Kontrol tidak valid."
	}
}

func permissionText(allow bool) string {
	if allow {
		return "Master mengizinkan semua user mengontrol video."
	}
	return "Kontrol dikembalikan ke master room."
}
