import { useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import { errorMessage, ingestNoteOrUrl } from "../api"
import type { ItemType } from "../api"

interface Props {
  /** runs after a save, so the list can load the new row. */
  onIngested: () => void
}

/** the save form: a type toggle, the content field, and the save button. */
export default function IngestForm({ onIngested }: Props): ReactElement {
  const [kind, setKind] = useState<ItemType>("note")
  const [content, setContent] = useState<string>("")
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const sendRef = useRef<AbortController | null>(null)

  // unmount aborts the request in flight, so no stale state update follows
  useEffect(() => () => sendRef.current?.abort(), [])

  /** sends the content, clears it on success, or shows the server message. */
  async function save(): Promise<void> {
    const text = content.trim()
    if (text.length === 0 || busy) return
    setError(null)
    setBusy(true)
    const ac = new AbortController()
    sendRef.current = ac
    try {
      await ingestNoteOrUrl(kind, text, ac.signal)
      // clear the input only on success, so a failure keeps the text for a fix
      setContent("")
      onIngested()
    } catch (err) {
      if (ac.signal.aborted) return
      setError(errorMessage(err))
    } finally {
      if (!ac.signal.aborted) setBusy(false)
    }
  }

  const placeholder =
    kind === "url"
      ? "Paste a link, for example https://example.com/article"
      : "Write a short note"
  const canSend = content.trim().length > 0 && !busy

  return (
    <section className="panel" aria-labelledby="ingest-title">
      <h2 className="panel__title" id="ingest-title">
        Save content
      </h2>
      <p className="panel__hint">Add a note or paste a link. The server fetches the page text for you.</p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="segmented" role="group" aria-label="Content type">
          <button
            type="button"
            className="segmented__btn"
            aria-pressed={kind === "note"}
            onClick={() => setKind("note")}
          >
            Note
          </button>
          <button
            type="button"
            className="segmented__btn"
            aria-pressed={kind === "url"}
            onClick={() => setKind("url")}
          >
            URL
          </button>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="ingest-content">
            Content
          </label>
          {kind === "url" ? (
            <input
              id="ingest-content"
              className="input"
              type="url"
              value={content}
              placeholder={placeholder}
              onChange={(event) => setContent(event.target.value)}
            />
          ) : (
            <textarea
              id="ingest-content"
              className="textarea"
              rows={4}
              value={content}
              placeholder={placeholder}
              onChange={(event) => setContent(event.target.value)}
            />
          )}
        </div>
        <button type="submit" className="btn" disabled={!canSend}>
          {busy ? "Saving…" : "Save"}
        </button>
        {error !== null ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  )
}
