const CHIPS = [
  "/summarize my saved items",
  "/find gaps in my sources",
  "/key claims with citations",
  "/compare two saved pages",
];

interface CommandChipsProps {
  onInsert: (text: string) => void;
}

export function CommandChips({ onInsert }: CommandChipsProps) {
  return (
    <div className="chips" aria-label="Commands">
      {CHIPS.map((chip) => (
        <button key={chip} type="button" className="chip" onClick={() => onInsert(`${chip} `)}>
          {chip}
        </button>
      ))}
    </div>
  );
}
