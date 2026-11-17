import { ExternalLink, Globe, Inbox, StickyNote, Loader2 } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import type { SavedItem } from "../api";

function relativeAge(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface SavedDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SavedItem[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function SavedDrawer({ open, onOpenChange, items, loading, error, onRetry }: SavedDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="saved-panel">
        <SheetHeader>
          <SheetTitle>Saved</SheetTitle>
          <SheetDescription className="saved-sub">Notes and pages you kept</SheetDescription>
        </SheetHeader>

        <div style={{ overflowY: "auto", flex: 1, padding: "4px 12px 16px" }}>
          {loading && items === null && (
            <>
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </>
          )}

          {error && (
            <div className="empty-block" role="alert">
              <div className="empty-title">Could not load your items</div>
              <div className="empty-hint">{error}</div>
              <button type="button" className="ingest-save" onClick={onRetry}>
                <Loader2 size={13} aria-hidden /> Try again
              </button>
            </div>
          )}

          {!loading && !error && items !== null && items.length === 0 && (
            <div className="empty-block">
              <Inbox size={26} strokeWidth={1.5} aria-hidden />
              <div className="empty-title">Nothing logged yet</div>
              <div className="empty-hint">Press + in the composer to save a note or a page.</div>
            </div>
          )}

          {items?.map((item) => (
            <div key={item.id} className="item-row">
              <div className="item-icon" aria-hidden>
                {item.type === "url" ? <Globe size={17} strokeWidth={1.75} /> : <StickyNote size={17} strokeWidth={1.75} />}
              </div>
              <div className="item-body">
                <div className="item-preview">{item.preview}</div>
                <div className="item-meta">
                  <span>{item.chunk_count} {item.chunk_count === 1 ? "chunk" : "chunks"}</span>
                  <span>{relativeAge(item.created_at)}</span>
                </div>
              </div>
              {item.type === "url" && item.source && (
                <a className="item-source" href={item.source} target="_blank" rel="noreferrer" aria-label="Open source page">
                  <ExternalLink size={17} strokeWidth={1.75} aria-hidden />
                </a>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

