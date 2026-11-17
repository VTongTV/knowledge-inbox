import { Bookmark } from "lucide-react";

interface SavedButtonProps {
  onOpen: () => void;
}

export function SavedButton({ onOpen }: SavedButtonProps) {
  return (
    <button type="button" className="saved-button" onClick={onOpen} aria-label="Open saved items">
      <Bookmark size={16} strokeWidth={1.75} aria-hidden />
      <span>Saved</span>
      <kbd className="kbd-chip">Ctrl K</kbd>
    </button>
  );
}
