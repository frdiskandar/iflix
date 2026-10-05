import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'

export default function Header() {
  const [scrolled, setScrolled] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={scrolled ? 'scrolled' : ''}>
      <Link to="/" className="logo">
        Iflix
      </Link>
      <nav>
        <Link to="/">Beranda</Link>
        {/* <a href="#">Serial TV</a>
        <a href="#">Film</a>
        <a href="#">Terbaru</a> */}
        <Link to="/rooms">Nonton Bareng</Link>
      </nav>
      <form
        className="header-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          const next = query.trim()
          if (next) navigate(`/search?q=${encodeURIComponent(next)}`)
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari film..."
          aria-label="Cari film"
          autoComplete="off"
        />
      </form>
    </header>
  )
}
