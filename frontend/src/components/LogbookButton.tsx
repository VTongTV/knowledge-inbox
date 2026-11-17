import { History } from "lucide-react";

interface LogbookButtonProps {
  onOpen: () => void;
}

export function LogbookButton({ onOpen }: LogbookButtonProps) {
  return (
    <button type="button" className="logbook-button" onClick={onOpen} aria-label="Open saved items">
      <History size={16} strokeWidth={1.75} aria-hidden />
      <span>Logbook</span>
      <kbd className="kbd-chip">Ctrl K</kbd>
    </button>
  );
}
