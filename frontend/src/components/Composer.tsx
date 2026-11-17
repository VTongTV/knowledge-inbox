import { ArrowUpRight, Check, ChevronDown, Globe, Mic, Plus, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { IngestPanel } from "./IngestPanel";
import type { ItemType } from "../api";

export type ModelName = "Auto" | "Fast" | "Balanced" | "Deep";
const MODELS: ModelName[] = ["Auto", "Fast", "Balanced", "Deep"];

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onAsk: (question: string) => void;
  onIngest: (kind: ItemType, content: string) => Promise<{ chunks: number }>;
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

export function Composer({ value, onChange, busy, onAsk, onIngest }: ComposerProps) {
  const [model, setModel] = useState<ModelName>("Auto");
  const [web, setWeb] = useState(false);
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="model-pill" aria-label={`Model: ${model}`}>
              <Sparkles size={16} aria-hidden />
              <span>{model}</span>
              <ChevronDown size={14} color="#8a8b90" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="model-menu" align="start" sideOffset={8}>
            {MODELS.map((name) => (
              <DropdownMenuItem key={name} onSelect={() => setModel(name)} className="model-item">
                <span>{name}</span>
                {model === name ? <Check size={14} aria-hidden /> : null}
              </DropdownMenuItem>
            ))}
            <div className="model-note">Only Auto is wired for this preview</div>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          className="icon-btn"
          aria-pressed={web}
          aria-label="Toggle web search"
          onClick={() => setWeb((v) => !v)}
        >
          <Globe size={18} strokeWidth={1.75} aria-hidden />
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
