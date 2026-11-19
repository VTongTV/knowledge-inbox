// command chips adapt knowledge inbox shortcuts to the knowledge inbox assessment.
// each chip inserts an actionable prompt template into the composer.

interface CommandChip {
  label: string;
  template: string;
}

const COMMANDS: CommandChip[] = [
  {
    label: "/skim a page",
    template: "/skim the key points from ",
  },
  {
    label: "/sketch a plan",
    template: "/sketch a plan from my notes on ",
  },
  {
    label: "/sift my notes",
    template: "/sift my notes for ",
  },
  {
    label: "/spot the gaps",
    template: "/spot the gaps in my sources about ",
  },
];

interface CommandChipsProps {
  onInsert: (text: string) => void;
}

export function CommandChips({ onInsert }: CommandChipsProps) {
  return (
    <div className="chips" aria-label="Commands">
      {COMMANDS.map((cmd) => (
        <button
          key={cmd.label}
          type="button"
          className="chip"
          onClick={() => onInsert(cmd.template)}
        >
          {cmd.label}
        </button>
      ))}
    </div>
  );
}
