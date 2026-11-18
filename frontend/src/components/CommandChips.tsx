// chips tailored to the knowledge-inbox assessment: each one drives
// ingest, or the cited-answer query loop.
const CHIPS = [
  "/summarize my saved items",
  "/what did I save about ",
  "/key claims with citations",
  "/find gaps in my sources",
];

interface CommandChipsProps {
  onInsert: (text: string) => void;
}

export function CommandChips({ onInsert }: CommandChipsProps) {
  return (
    <div className="chips" aria-label="Commands">
      {CHIPS.map((chip) => (
        <button
          key={chip}
          type="button"
          className="chip"
          onClick={() => onInsert(chip.trimEnd() + " ")}
        >
          {chip.trimEnd()}
        </button>
      ))}
    </div>
  );
}
