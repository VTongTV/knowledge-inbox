import { useCallback, useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import IngestForm from "./components/IngestForm"
import ItemList from "./components/ItemList"
import QuestionPanel from "./components/QuestionPanel"
import { errorMessage, fetchItems } from "./api"
import type { SavedItem } from "./api"

/** holds the three areas and the item list they share. */
export default function App(): ReactElement {
  const [items, setItems] = useState<SavedItem[]>([])
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [itemsBusy, setItemsBusy] = useState<boolean>(true)

  const loadRef = useRef<AbortController | null>(null)

  /** loads the item list, and aborts the prior call when a newer one starts. */
  const reload = useCallback(async (): Promise<void> => {
    loadRef.current?.abort()
    const ac = new AbortController()
    loadRef.current = ac
    try {
      setItems(await fetchItems(ac.signal))
      setItemsError(null)
    } catch (err) {
      if (ac.signal.aborted) return
      setItemsError(errorMessage(err))
    } finally {
      if (!ac.signal.aborted) setItemsBusy(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    return () => loadRef.current?.abort()
  }, [reload])

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Knowledge Inbox</h1>
        <p className="app__subtitle">
          Save a note or a link, then ask a question over what you saved.
        </p>
      </header>
      <main className="app__main">
        <div className="app__rail">
          <IngestForm onIngested={reload} />
          <QuestionPanel />
        </div>
        <ItemList items={items} busy={itemsBusy} error={itemsError} onRetry={reload} />
      </main>
    </div>
  )
}
