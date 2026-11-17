const CHIPS = ["/skim a thread", "/sketch a plan", "/sift my notes", "/sharpen a draft"];

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
