import Lenis from 'lenis'
import { useEffect } from 'react'

// Starts Lenis smooth vertical scrolling for the page lifetime.
// StrictMode-safe: the instance is created and destroyed per mount.
// Skipped when the user prefers reduced motion.
export function useLenis() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    const lenis = new Lenis({
      lerp: 0.1,
      smoothWheel: true,
    })

    let rafId = 0
    const loop = (time: number) => {
      lenis.raf(time)
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
    }
  }, [])
}
