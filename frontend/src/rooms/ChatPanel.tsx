import { useEffect, useRef, useState } from 'react'
import type { RoomChat, RoomNotice } from '../hooks/useRoomSocket.ts'

interface ChatPanelProps {
  chats: RoomChat[]
  notices: RoomNotice[]
  selfName: string
  onSend: (text: string) => boolean
}

function timeOf(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function ChatPanel({ chats, notices, selfName, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [chats.length, notices.length])

  return (
    <section className="room-chat" aria-label="Chat room">
      <h3>Chat</h3>
      <div className="room-chat-list">
        {notices.slice(-5).map((n) => (
          <p key={`${n.kind}-${n.at}`} className={`room-notice room-notice-${n.kind}`}>
            {n.text}
          </p>
        ))}
        {chats.length === 0 ? <p className="room-hint">Belum ada chat. Sapa room-nya!</p> : null}
        {chats.map((c) => (
          <p key={c.seq} className={c.username === selfName ? 'room-msg room-msg-self' : 'room-msg'}>
            <span className="room-msg-head">
              <strong>{c.username}</strong> <time>{timeOf(c.at)}</time>
            </span>
            <span className="room-msg-text">{c.text}</span>
          </p>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="room-chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim() && onSend(draft)) setDraft('')
        }}
      >
        <input
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tulis chat..."
          aria-label="Tulis chat"
        />
        <button type="submit" disabled={!draft.trim()}>
          Kirim
        </button>
      </form>
    </section>
  )
}
