import { useEffect } from "react";

const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: "Ctrl K", action: "Open or close Logbook" },
  { keys: "Enter", action: "Ask" },
  { keys: "Shift+Enter", action: "New line in the question" },
  { keys: "Esc", action: "Close panels" },
];

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  // esc closes the panel.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="help-backdrop" role="presentation" onClick={onClose}>
      <div
        className="help-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="help-title" id="help-title">Keyboard</h2>
        <p className="logbook-sub">Everything you save stays on this device.</p>
        <ul className="help-list">
          {SHORTCUTS.map(({ keys, action }) => (
            <li key={keys} className="help-row">
              <kbd className="kbd-chip">{keys}</kbd>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
