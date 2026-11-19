import { useCallback, useEffect, useRef, useState } from "react";

import { AppFrame } from "./components/AppFrame";
import { LogbookButton } from "./components/LogbookButton";
import { LogbookDrawer } from "./components/LogbookDrawer";
import { HelpDialog } from "./components/HelpDialog";
import { Hero } from "./components/Hero";
import type { ThreadMessage } from "./components/Hero";
import { AsciiField } from "./components/AsciiField/AsciiField";
import {
  askQuestion,
  errorMessage,
  fetchItems,
  ingestNoteOrUrl,
} from "./api";
import type { IngestedRow, ItemType, SavedItem } from "./api";

const POLL_INTERVAL_MS = 500;
const POLL_MAX_ATTEMPTS = 60;

/** asks one question, appends the user line and the answer to the thread. */
export default function App() {
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<number | null>(null);

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    setItemsLoading(true);
    setItemsError(null);
    try {
      const rows = await fetchItems(signal);
      setItems(rows);
    } catch (err) {
      if (signal?.aborted) return;
      setItemsError(errorMessage(err));
    } finally {
      if (!signal?.aborted) setItemsLoading(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadItems(controller.signal);
    return () => controller.abort();
  }, [loadItems]);

  // poll /items until the background embed lands its chunks on the target item
  const pollChunks = useCallback(async (itemId: number): Promise<boolean> => {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        const rows = await fetchItems();
        const found = rows.find((item) => item.id === itemId);
        if (found && found.chunk_count > 0) {
          setItems(rows);
          return true;
        }
      } catch {
        // a transient list failure does not abort the poll
      }
    }
    return false;
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);

  // ctrl+k opens the logbook anywhere on screen.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDrawerOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ask = useCallback((question: string) => {
    const userId = nextId.current++;
    setThread((cur) => [...cur, { id: userId, role: "user", text: question }]);
    setAsking(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    void askQuestion(question, abortRef.current.signal)
      .then((result) => {
        setThread((cur) => [
          ...cur,
          {
            id: nextId.current++,
            role: "bot",
            text: result.answer,
            sources: result.sources,
          },
        ]);
      })
      .catch((err: unknown) => {
        if (abortRef.current?.signal.aborted) return;
        setThread((cur) => [
          ...cur,
          { id: nextId.current++, role: "bot", text: errorMessage(err), error: true },
        ]);
      })
      .finally(() => setAsking(false));
  }, []);

  const ingest = useCallback(
    async (kind: ItemType, content: string): Promise<IngestedRow> => {
      const row = await ingestNoteOrUrl(kind, content);
      showToast("Saving…");
      void (async () => {
        const ready = await pollChunks(row.id);
        showToast(ready ? "Saved to Logbook" : "Saving failed — the page could not be processed");
        void loadItems();
      })();
      return row;
    },
    [loadItems, showToast],
  );

  const resetChat = useCallback(() => {
    abortRef.current?.abort();
    setThread([]);
    setAsking(false);
    document.getElementById("composer-input")?.focus();
  }, []);

  return (
    <AppFrame
      backgroundField={<AsciiField />}
      onResetChat={resetChat}
      onOpenSaved={() => setDrawerOpen(true)}
      onHelp={() => setHelpOpen(true)}
    >
      <LogbookButton onOpen={() => setDrawerOpen(true)} />
      <Hero messages={thread} asking={asking} onAsk={ask} onIngest={ingest} />
      {toast && <div className="toast" role="status">{toast}</div>}
      <LogbookDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        items={items}
        loading={itemsLoading}
        error={itemsError}
        onRetry={() => void loadItems()}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </AppFrame>
  );
}
