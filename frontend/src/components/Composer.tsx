import { ArrowUpRight, Database, Mic, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { IngestPanel } from "./IngestPanel";
import type { ItemType } from "../api";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  /** how many items are saved, or null while the first list load runs. */
  savedCount: number | null;
  onAsk: (question: string) => void;
  onIngest: (kind: ItemType, content: string) => Promise<{ chunks: number }>;
  onOpenSaved: () => void;
}

interface RecognitionResultItem {
  transcript: string;
}

interface RecognitionResultList extends ArrayLike<ArrayLike<RecognitionResultItem>> {
  length: number;
}

interface RecognitionEvent extends Event {
  results: RecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** returns the browser speech constructor when it exists, else null. */
function speechCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function Composer({ value, onChange, busy, savedCount, onAsk, onIngest, onOpenSaved }: ComposerProps) {
  const [listening, setListening] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const speech = speechCtor();

  // the textarea grows with the content, from one line to six.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [value]);

  useEffect(() => {
    return () => recognitionRef.current?.stop();
  }, []);

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

  // fill the textarea with heard speech when the browser can listen.
  function toggleMic() {
    if (!speech) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new speech();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.onresult = (event) => {
      let said = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        said += event.results[i][0].transcript;
      }
      onChange(said);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <form className="composer" onSubmit={onSubmit} aria-label="Ask Knowledge Inbox">
      <textarea
        ref={areaRef}
        id="composer-input"
        className="composer-textarea"
        placeholder="Ask Knowledge Inbox anything..."
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
            <button type="button" className="icon-btn" aria-label="Save a note or a page">
              <Plus size={20} strokeWidth={1.75} aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent className="ingest-popover" sideOffset={10} align="start">
            <IngestPanel onIngest={onIngest} onSaved={() => setIngestOpen(false)} />
          </PopoverContent>
        </Popover>

        <button
          type="button"
          className="status-chip"
          onClick={onOpenSaved}
          aria-label="Open saved items"
        >
          <Database size={14} strokeWidth={1.75} aria-hidden />
          <span>{savedCount ?? "…"} saved</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label={speech ? (listening ? "Stop dictation" : "Start dictation") : "Voice input unavailable in this browser"}
          aria-pressed={listening}
          disabled={!speech}
          onClick={toggleMic}
        >
          <Mic size={18} strokeWidth={1.75} aria-hidden />
        </button>

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
