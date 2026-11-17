import { useEffect, useRef, useState } from "react";

import { Greeting } from "./Greeting";
import { RotatingHeadline } from "./RotatingHeadline";
import { Composer } from "./Composer";
import { CommandChips } from "./CommandChips";
import { FooterNote } from "./FooterNote";
import type { CitedSource, ItemType } from "../api";

export interface ThreadMessage {
  id: number;
  role: "user" | "bot";
  text: string;
  sources?: CitedSource[];
  error?: boolean;
}

interface HeroProps {
  messages: ThreadMessage[];
  asking: boolean;
  onAsk: (question: string) => void;
  onIngest: (kind: ItemType, content: string) => Promise<{ chunks: number }>;
}

export function Hero({ messages, asking, onAsk, onIngest }: HeroProps) {
  const [draft, setDraft] = useState("");
  const [openSource, setOpenSource] = useState<number | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const pristine = messages.length === 0 && !asking;

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, asking]);

  return (
    <>
      <div className="hero">
        {pristine ? <Greeting /> : null}
        {pristine ? (
          <RotatingHeadline />
        ) : (
          <div className="thread" ref={threadRef} aria-live="polite">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="msg-user">{msg.text}</div>
              ) : (
                <div key={msg.id} className={`msg-bot${msg.error ? " msg-bot-error" : ""}`}>
                  <div>{msg.text}</div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="sources" aria-label="Cited sources">
                      {msg.sources.map((src, i) => (
                        <button
                          key={i}
                          type="button"
                          className="src-chip"
                          aria-expanded={openSource === src.item_id * 1000 + src.chunk_index}
                          onClick={() =>
                            setOpenSource((cur) =>
                              cur === src.item_id * 1000 + src.chunk_index
                                ? null
                                : src.item_id * 1000 + src.chunk_index,
                            )
                          }
                        >
                          [{i + 1}] item {src.item_id} · {Math.round(Math.min(1, src.score) * 100)}%
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.sources?.map((src, i) =>
                    openSource === src.item_id * 1000 + src.chunk_index ? (
                      <div key={i} className="src-expand">
                        <div className="src-expand-head">item {src.item_id}, chunk {src.chunk_index}</div>
                        <div>{src.text}</div>
                      </div>
                    ) : null,
                  )}
                </div>
              ),
            )}
            {asking && (
              <div className="thread-thinking" aria-label="Searching your saved items">
                <span className="pulse-dot" />
                <span className="pulse-dot" />
                <span className="pulse-dot" />
                <span style={{ marginLeft: 8 }}>searching your logbook</span>
              </div>
            )}
          </div>
        )}

        <Composer
          value={draft}
          onChange={setDraft}
          busy={asking}
          onAsk={(question) => {
            onAsk(question);
            setDraft("");
          }}
          onIngest={onIngest}
        />

        {pristine ? <CommandChips onInsert={(text) => setDraft((cur) => cur + text)} /> : null}
      </div>
      <FooterNote />
    </>
  );
}
