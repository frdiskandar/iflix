import { Link, Route, Routes } from 'react-router'
import DisclaimerModal from './components/DisclaimerModal.tsx'
import Footer from './components/Footer.tsx'
import Header from './components/Header.tsx'
import HomePage from './pages/HomePage.tsx'
import SearchPage from './pages/SearchPage.tsx'
import WatchMoviePage from './pages/WatchMoviePage.tsx'
import WatchSeriesPage from './pages/WatchSeriesPage.tsx'
import RoomPage from './rooms/RoomPage.tsx'
import RoomsLanding from './rooms/RoomsLanding.tsx'

export default function App() {
  return (
    <>
      <DisclaimerModal />
      <Header />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/watch/movie/:slug" element={<WatchMoviePage />} />
        <Route path="/watch/series/:slug/season/:season/episode/:episode" element={<WatchSeriesPage />} />
        <Route path="/watch/series/:slug" element={<WatchSeriesPage />} />
        <Route path="/rooms" element={<RoomsLanding />} />
        <Route path="/rooms/:code" element={<RoomPage />} />
        <Route
          path="*"
          element={
            <main className="watch-page">
              <h1 className="watch-title">Halaman tidak ditemukan</h1>
              <Link className="watch-back" to="/">
                ← Kembali ke Beranda
              </Link>
            </main>
          }
        />
      </Routes>
      <Footer />
    </>
  )
}
