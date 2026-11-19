import { ArrowUpRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { IngestPanel } from "./IngestPanel";
import type { ItemType } from "../api";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onAsk: (question: string) => void;
  onIngest: (kind: ItemType, content: string) => Promise<{ chunks: number }>;
}

export function Composer({ value, onChange, busy, onAsk, onIngest }: ComposerProps) {
  const [ingestOpen, setIngestOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // the textarea grows with the content, from one line to six.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [value]);

  function submit() {
    const question = value.trim();
    if (!question || busy) return;
    onAsk(question);
    onChange("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  return (
    <form className="composer" onSubmit={onSubmit} aria-label="Ask a question">
      <textarea
        ref={areaRef}
        id="composer-input"
        className="composer-textarea"
        placeholder="Ask anything..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        autoFocus
        disabled={busy}
        aria-label="Question"
      />
      <div className="toolbar">
        <Popover open={ingestOpen} onOpenChange={setIngestOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="icon-btn" aria-label="Add a note or page">
              <Plus size={20} strokeWidth={1.75} aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent className="ingest-popover" sideOffset={10} align="start">
            <IngestPanel onIngest={onIngest} onSaved={() => setIngestOpen(false)} />
          </PopoverContent>
        </Popover>

        <span className="hint">↵ ask · ⇧↵ new line</span>

        <button
          type="submit"
          className={`send-btn${value.trim() ? " active" : ""}`}
          aria-label="Ask"
          disabled={busy}
        >
          <ArrowUpRight size={17} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </form>
  );
}
