interface ChipRowProps {
  title: string
  items: string[]
  loading?: boolean
  error?: string
}

export default function ChipRow({ title, items, loading, error }: ChipRowProps) {
  if (loading) {
    return (
      <section className="content-section">
        <h2 className="section-title">{title}</h2>
        <p className="row-state" aria-busy="true">
          Memuat...
        </p>
      </section>
    )
  }
  if (error || items.length === 0) return null
  return (
    <section className="content-section">
      <h2 className="section-title">{title}</h2>
      <div className="chip-row">
        {items.map((chip) => (
          <span className="chip" key={chip}>
            {chip}
          </span>
        ))}
      </div>
    </section>
  )
}
