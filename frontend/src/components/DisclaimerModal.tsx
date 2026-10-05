import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'stream-platform:disclaimer-acknowledged:v1'

function alreadyAcknowledged(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function rememberAcknowledged(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    // Penyimpanan tidak tersedia (mode privat, dsb) —
    // modal cukup ditutup tanpa mengingat.
  }
}

// Modal peringatan sekali-tayang: muncul saat kunjungan pertama,
// ditutup via tombol (atau Escape), lalu tidak muncul lagi.
export default function DisclaimerModal() {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!alreadyAcknowledged()) {
      setOpen(true)
    }
  }, [])

  const dismiss = useCallback(() => {
    rememberAcknowledged()
    setOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return
    buttonRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, dismiss])

  if (!open) return null

  return (
    <div className="disclaimer-overlay" data-testid="disclaimer-modal">
      <div
        className="disclaimer-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disclaimer-title"
        aria-describedby="disclaimer-desc"
      >
        <h2 id="disclaimer-title" className="disclaimer-title">
          Peringatan
        </h2>
        <p id="disclaimer-desc" className="disclaimer-desc">
        <strong>educational purpose only</strong> — Website ini dibuat untuk
          bahan pembelajaran pengembangan aplikasi streaming video.
        </p>
        <button
          ref={buttonRef}
          className="btn btn-play disclaimer-button"
          type="button"
          onClick={dismiss}
        >
          Saya Mengerti
        </button>
      </div>
    </div>
  )
}
