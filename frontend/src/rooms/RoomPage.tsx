import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useRoomSocket } from '../hooks/useRoomSocket.ts'
import ChatPanel from './ChatPanel.tsx'
import VideoStage from './VideoStage.tsx'
import { loadUsername, saveUsername, validUsername } from './username.ts'

export default function RoomPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState(() => loadUsername())
  const [draft, setDraft] = useState(name)

  const room = useRoomSocket(code.toUpperCase(), name)

  if (!validUsername(name)) {
    return (
      <main className="watch-page room-gate-page">
        <h1 className="watch-title">Masuk ke room {code.toUpperCase()}</h1>
        <p className="room-hint">Isi username dulu — disimpan di perangkat ini untuk kunjungan berikutnya.</p>
        <form
          className="room-linkform"
          onSubmit={(e) => {
            e.preventDefault()
            if (validUsername(draft)) {
              saveUsername(draft.trim())
              setName(draft.trim())
            }
          }}
        >
          <input
            value={draft}
            maxLength={20}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Username (1-20 karakter)"
            aria-label="Username"
          />
          <button type="submit" disabled={!validUsername(draft)}>
            Masuk
          </button>
        </form>
        <Link className="watch-back" to="/rooms">
          ← Pilih room lain
        </Link>
      </main>
    )
  }

  const { phase, selfName, members, isMaster, canControl, state, chats, notices, control, chat, setPermission, reconnect, lastSend } = room

  const phaseText =
    phase === 'open' ? 'Terhubung' : phase === 'reconnecting' ? 'Terputus — mencoba lagi…' : phase === 'connecting' ? 'Menghubungkan…' : 'Terputus'

  const sendText = lastSend
    ? lastSend.ok
      ? ` · perintah terkirim ${new Date(lastSend.at).toLocaleTimeString()}`
      : ' · GAGAL mengirim (socket tertutup)'
    : ''

  return (
    <main className="watch-page room-page">
      <div className="room-topbar">
        <Link className="watch-back" to="/rooms">
          ← Keluar
        </Link>
        <h1 className="room-code" title="Kode room — bagikan ke teman">
          Room {code.toUpperCase()}
        </h1>
        <span className={`room-conn room-conn-${phase}`} role="status" title={sendText || undefined}>
          {phaseText}
          {sendText ? <small>{sendText}</small> : null}
        </span>
        {phase !== 'open' ? (
          <button type="button" onClick={reconnect}>
            Hubungkan ulang
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(window.location.href).catch(() => {})
          }}
        >
          Salin link
        </button>
      </div>
      {phase !== 'open' ? (
        <p className="row-state" aria-busy="true">
          {phase === 'reconnecting' ? 'Koneksi terputus, mencoba lagi...' : 'Menghubungkan ke room...'}
        </p>
      ) : null}

      <VideoStage state={state} canControl={canControl} control={control} />

      <div className="room-side">
        <section className="room-members" aria-label="Anggota room">
          <h3>
            Anggota ({members.length}){isMaster ? ' · kamu master' : ''}
          </h3>
          <ul>
            {members.map((m) => (
              <li key={m.username}>
                {m.username}
                {m.username === selfName ? ' (kamu)' : ''}
                {m.is_master ? ' 👑' : ''}
              </li>
            ))}
          </ul>
          {isMaster ? (
            <label className="room-permit">
              <input
                type="checkbox"
                checked={state?.allow_all ?? false}
                onChange={(e) => setPermission(e.target.checked)}
              />
              Semua user boleh kontrol video
            </label>
          ) : (
            <p className="room-hint">
              {state?.allow_all ? 'Semua user boleh mengontrol video.' : 'Mode master: hanya master yang bisa mengontrol.'}
            </p>
          )}
          <button className="btn-retry" type="button" onClick={() => navigate('/rooms')}>
            Ganti room
          </button>
        </section>
        <ChatPanel chats={chats} notices={notices} selfName={selfName} onSend={chat} />
      </div>
    </main>
  )
}
