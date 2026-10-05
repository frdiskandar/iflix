import { useState } from 'react'
import { useNavigate } from 'react-router'
import { createRoom, roomInfo } from './api.ts'
import { loadUsername, saveMasterKey, saveUsername, validUsername } from './username.ts'

export default function RoomsLanding() {
  const navigate = useNavigate()
  const [name, setName] = useState(() => loadUsername())
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needName = !validUsername(name)

  async function ensureName(): Promise<boolean> {
    if (!validUsername(name)) {
      setError('Isi username dulu (1-20 karakter).')
      return false
    }
    saveUsername(name.trim())
    return true
  }

  async function onCreate() {
    if (!(await ensureName())) return
    setBusy(true)
    setError(null)
    try {
      const r = await createRoom(name.trim())
      saveMasterKey(r.room_code, r.master_key)
      navigate(`/rooms/${r.room_code}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat room')
    } finally {
      setBusy(false)
    }
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!(await ensureName())) return
    const code = joinCode.trim().toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setError('Kode room 6 karakter (huruf/angka).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await roomInfo(code)
      navigate(`/rooms/${code}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Room tidak ditemukan')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="watch-page rooms-landing">
      <h1 className="watch-title">Nonton Bareng</h1>
      <p className="room-hint">
        Satu room, satu video, posisi yang sama. Master mengatur video — atau izinkan semua user ikut mengontrol. Ada chat
        realtime di dalam room.
      </p>
      <label className="rooms-field">
        Username kamu
        <input
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          placeholder="mis. agus"
        />
      </label>
      {needName ? <p className="room-hint">Username disimpan di perangkat ini saja.</p> : null}
      <div className="rooms-actions">
        <button type="button" disabled={busy || needName} onClick={onCreate}>
          {busy ? '...' : 'Buat room baru'}
        </button>
      </div>
      <form className="room-linkform" onSubmit={onJoin}>
        <input
          value={joinCode}
          maxLength={6}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="Kode room (6 karakter)"
          aria-label="Kode room"
        />
        <button type="submit" disabled={busy || needName}>
          Gabung
        </button>
      </form>
      {error ? (
        <p className="row-state" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  )
}
