import type { WatchState } from '../hooks/useWatchGate.ts'

interface WatchPlayerProps {
  watch: WatchState
  poster?: string | null
  title: string
}

export default function WatchPlayer({ watch, poster, title }: WatchPlayerProps) {
  const { phase, gate, unlockInSec, playableUrl, subtitles, videoTitle, maxHeight, error, retry } = watch
  const preroll = gate?.preroll
  const ad = preroll?.ad

  if (phase === 'ready' && playableUrl) {
    return (
      <div className="watch-player">
        <video
          className="watch-video"
          src={playableUrl}
          controls
          playsInline
          crossOrigin="anonymous"
          title={videoTitle ?? title}
        >
          {subtitles.map((s) => (
            <track key={s.lang} kind="subtitles" srcLang={s.lang} label={s.label ?? s.lang} src={s.path} default={s.lang === 'id'} />
          ))}
        </video>
        <p className="watch-meta">
          {videoTitle ?? title}
          {maxHeight ? ` · maks ${maxHeight}p (guest)` : null}
        </p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="watch-player watch-gate" role="alert">
        {poster ? <img className="watch-gate-poster" src={poster} alt="" aria-hidden="true" /> : null}
        <p className="watch-gate-text">{error ?? 'Gagal memuat video.'}</p>
        <button className="btn btn-play" type="button" onClick={retry}>
          Coba lagi
        </button>
      </div>
    )
  }

  return (
    <div className="watch-player watch-gate" aria-busy="true">
      {ad?.imageUrl ? (
        <a href={ad.targetUrl ?? '#'} target="_blank" rel="noreferrer">
          <img className="watch-ad" src={ad.imageUrl} alt={ad.name ?? 'Iklan'} />
        </a>
      ) : poster ? (
        <img className="watch-gate-poster" src={poster} alt="" aria-hidden="true" />
      ) : null}
      <p className="watch-gate-text">
        {phase === 'gating' && 'Menyiapkan sesi nonton...'}
        {phase === 'locked' && `Video terbuka dalam ${unlockInSec} detik...`}
        {phase === 'claiming' && 'Mengklaim sesi pemutaran...'}
        {phase === 'redeeming' && 'Menghubungkan ke server stream...'}
        {phase === 'idle' && 'Menunggu konten...'}
      </p>
      {phase === 'locked' ? (
        <div className="watch-progress" aria-hidden="true">
          <div
            className="watch-progress-bar"
            style={{ width: `${gate && gate.unlockAt > gate.serverNow ? Math.min(100, Math.max(0, (1 - (unlockInSec * 1000) / (gate.unlockAt - gate.serverNow)) * 100)) : 0}%` }}
          />
        </div>
      ) : (
        <p className="watch-gate-sub">Jangan tutup halaman ini.</p>
      )}
    </div>
  )
}
