import { Link2, StickyNote, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { errorMessage } from "../api";
import type { ItemType } from "../api";

interface IngestPanelProps {
  onIngest: (kind: ItemType, content: string) => Promise<{ chunks: number }>;
  /** called after a saved item so the popover can close itself. */
  onSaved: () => void;
}

export function IngestPanel({ onIngest, onSaved }: IngestPanelProps) {
  const [kind, setKind] = useState<ItemType>("note");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a fresh popover each open starts from the note tab.
  useEffect(() => {
    setError(null);
  }, [kind]);

  async function save() {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onIngest(kind, text);
      setContent("");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ingest-panel">
      <div className="ingest-kind" role="tablist" aria-label="What to save">
        <button
          type="button"
          role="tab"
          aria-selected={kind === "note"}
          className={`kind-tab${kind === "note" ? " active" : ""}`}
          onClick={() => setKind("note")}
        >
          <StickyNote size={13} aria-hidden /> Note
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === "url"}
          className={`kind-tab${kind === "url" ? " active" : ""}`}
          onClick={() => setKind("url")}
        >
          <Link2 size={13} aria-hidden /> URL
        </button>
      </div>

      {kind === "note" ? (
        <textarea
          className="ingest-input"
          placeholder="Paste a note, a quote, a stray fact..."
          value={content}
          onChange={(event) => setContent(event.target.value)}
          aria-label="Note text"
        />
      ) : (
        <input
          className="ingest-url"
          type="url"
          placeholder="https://example.com/page"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          aria-label="Page url"
        />
      )}

      {error && <div className="ingest-error" role="alert">{error}</div>}

      <button type="button" className="ingest-save" onClick={save} disabled={busy || !content.trim()}>
        {busy ? <Loader2 size={13} className="spin" aria-hidden /> : null}
        Save to Logbook
      </button>
    </div>
  );
}
