import { useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import { askQuestion, errorMessage } from "../api"
import type { AskResult } from "../api"

// the cold-start sentence the server returns when the store is empty
const EMPTY_STORE = "No content is saved yet"

/** the ask area: one question, the answer, and the chunks the answer cites. */
export default function QuestionPanel(): ReactElement {
  const [question, setQuestion] = useState<string>("")
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AskResult | null>(null)

  const askRef = useRef<AbortController | null>(null)

  // unmount aborts the request in flight, so no stale state update follows
  useEffect(() => () => askRef.current?.abort(), [])

  /** sends the question, then stores the answer or the server message. */
  async function ask(): Promise<void> {
    const text = question.trim()
    if (text.length === 0 || busy) return
    setError(null)
    setResult(null)
    setBusy(true)
    const ac = new AbortController()
    askRef.current = ac
    try {
      setResult(await askQuestion(text, ac.signal))
    } catch (err) {
      if (ac.signal.aborted) return
      setError(errorMessage(err))
    } finally {
      if (!ac.signal.aborted) setBusy(false)
    }
  }

  const canAsk = question.trim().length > 0 && !busy
  const cold = result !== null && result.answer.startsWith(EMPTY_STORE)

  return (
    <section className="panel" aria-labelledby="ask-title">
      <h2 className="panel__title" id="ask-title">
        Ask a question
      </h2>
      <p className="panel__hint">
        The answer draws on the content you saved, and lists the chunks it came from.
      </p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void ask()
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="ask-question">
            Question
          </label>
          <input
            id="ask-question"
            className="input"
            type="text"
            value={question}
            placeholder="What did I save about sqlite?"
            onChange={(event) => setQuestion(event.target.value)}
          />
        </div>
        <button type="submit" className="btn" disabled={!canAsk}>
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>

      {error !== null ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {busy ? <p className="pending">Waiting for the answer…</p> : null}
      {result !== null ? (
        <div className="result">
          <p className={cold ? "notice" : "answer"}>{result.answer}</p>
          {cold ? null : (
            <div className="sources">
              <p className="sources__title">Cited sources ({result.sources.length})</p>
              {result.sources.length > 0 ? (
                <ul className="sources__list">
                  {result.sources.map((source) => {
                    const pct = Math.max(0, Math.min(100, Math.round(source.score * 100)))
                    return (
                      <li
                        className="source"
                        key={`${source.item_id}:${source.chunk_index}`}
                      >
                        <div className="source__head">
                          <span>
                            item {source.item_id} · chunk {source.chunk_index}
                          </span>
                          <span>relevance {pct}%</span>
                        </div>
                        <p className="source__text">{source.text}</p>
                        <span className="meter" aria-hidden="true">
                          <span className="meter__bar" style={{ width: `${pct}%` }} />
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="muted">The answer cites no source.</p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
