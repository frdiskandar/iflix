// Username + master-key persistence (localStorage only).
// No account, no server-side user data: the name is self-claimed per
// visitor, the masterKey reclaims room ownership across reconnects.

const USER_KEY = 'watchtogether.username'

export function loadUsername(): string {
  try {
    return (localStorage.getItem(USER_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

export function saveUsername(name: string): void {
  try {
    localStorage.setItem(USER_KEY, name.trim())
  } catch {
    // Private mode etc: room still works for this session.
  }
}

function masterKeyName(code: string): string {
  return `watchtogether.masterKey.${code.toUpperCase()}`
}

export function loadMasterKey(code: string): string {
  try {
    return localStorage.getItem(masterKeyName(code)) ?? ''
  } catch {
    return ''
  }
}

export function saveMasterKey(code: string, key: string): void {
  try {
    if (key) localStorage.setItem(masterKeyName(code), key)
  } catch {
    // ignore
  }
}

export function validUsername(name: string): boolean {
  const n = name.trim()
  return n.length >= 1 && [...n].length <= 20
}
