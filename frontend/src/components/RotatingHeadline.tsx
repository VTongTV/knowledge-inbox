import { useEffect, useState } from "react";
import type React from "react";

const PHRASES = [
  "ask your notes anything",
  "every answer cited",
  "clear the reading backlog",
  "find what you already saved",
];

const PHRASE_SECONDS = 5;

export function RotatingHeadline() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % PHRASES.length);
    }, PHRASE_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, []);

  const words = PHRASES[index].split(" ");

  return (
    <h1 className="headline" aria-live="off">
      <span className="sr-only">{PHRASES[0]}</span>
      <span key={index} aria-hidden>
        {words.map((word, i) => (
          <span
            key={`${index}-${i}`}
            className="word"
            style={{ "--i": i } as React.CSSProperties}
          >
            {i === words.length - 1 ? <span className="word-accent">{word}</span> : word}
          </span>
        ))}
      </span>
    </h1>
  );
}
