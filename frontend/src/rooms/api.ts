// REST helpers for watch-together rooms (backend /api/v1/rooms,
// resolved against the backend origin so split deployments work).
import { backendUrl } from '../lib/api.ts';

export interface CreatedRoom {
  room_code: string
  master_key: string
}

export interface RoomInfo {
  room_code: string
  members: number
  has_video: boolean
  video_type: string
  allow_all: boolean
  master: string
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) return body.error
  } catch {
    // fall through
  }
  return `Request gagal: ${res.status}`
}

export async function createRoom(username: string, signal?: AbortSignal): Promise<CreatedRoom> {
  const res = await fetch(backendUrl('/api/v1/rooms'), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
    signal,
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as CreatedRoom
}

export async function roomInfo(code: string, signal?: AbortSignal): Promise<RoomInfo> {
  const res = await fetch(backendUrl(`/api/v1/rooms/${encodeURIComponent(code)}`), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as RoomInfo
}
