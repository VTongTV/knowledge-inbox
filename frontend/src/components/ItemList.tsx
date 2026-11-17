import type { ReactElement } from "react"
import type { SavedItem } from "../api"

interface Props {
  /** the rows GET /items returned. */
  items: SavedItem[]
  /** true while the first load runs. */
  busy: boolean
  /** the load failure, or null when the load succeeded. */
  error: string | null
  /** runs when the user asks for another load. */
  onRetry: () => void
}

/** turns one iso timestamp into a local, readable form, and keeps the raw value when the parse fails. */
function localTime(raw: string): string {
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString()
}

/** the saved items, one row per item, or one clear line when the store is empty. */
export default function ItemList({ items, busy, error, onRetry }: Props): ReactElement {
  let body: ReactElement
  if (busy && items.length === 0) {
    body = <p className="pending">Loading the list…</p>
  } else if (items.length === 0 && error === null) {
    body = <p className="empty">Nothing saved yet. Add a note or a URL first.</p>
  } else {
    body = (
      <ul className="items">
        {items.map((item) => (
          <li className="item" key={item.id}>
            <p className="item__preview">
              {item.preview.length > 0 ? item.preview : "No preview text."}
            </p>
            <div className="item__meta">
              <span className="item__kind">{item.type}</span>
              {item.type === "url" ? (
                <a className="item__source" href={item.source}>
                  {item.source}
                </a>
              ) : null}
              <span className="item__time">{localTime(item.created_at)}</span>
              <span className="item__chunks">
                {item.chunk_count} {item.chunk_count === 1 ? "chunk" : "chunks"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="panel" aria-labelledby="items-title">
      <div className="panel__head">
        <h2 className="panel__title" id="items-title">
          Saved items
        </h2>
        <span className="panel__count">{items.length} saved</span>
      </div>
      {error !== null ? (
        <div className="alertbox">
          <p className="alert" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn--ghost btn--small" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {body}
    </section>
  )
}
