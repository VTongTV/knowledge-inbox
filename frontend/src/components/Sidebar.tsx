import { Bookmark, CircleHelp, PanelLeft, SquarePen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { PixelLogo } from "./PixelLogo";

interface NavDef {
  y: number;
  icon: LucideIcon;
  label: string;
  id: string;
  action: "reset" | "saved" | "help" | "collapse";
}

const NAV_ITEMS: NavDef[] = [
  { y: 108, icon: SquarePen, label: "New chat", id: "new-chat", action: "reset" },
  { y: 158, icon: Bookmark, label: "Saved", id: "saved", action: "saved" },
  { y: 208, icon: CircleHelp, label: "Help", id: "help", action: "help" },
  { y: 580, icon: PanelLeft, label: "Collapse sidebar", id: "collapse", action: "collapse" },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onReset: () => void;
  onOpenSaved: () => void;
  onHelp: () => void;
}

export function Sidebar({ collapsed, onToggle, onReset, onOpenSaved, onHelp }: SidebarProps) {
  const [active, setActive] = useState("new-chat");
  const activeY = NAV_ITEMS.find((i) => i.id === active)?.y ?? 108;

  const run = (action: NavDef["action"]) => {
    if (action === "collapse") {
      onToggle();
      return;
    }
    if (action === "reset") {
      setActive("new-chat");
      onReset();
      return;
    }
    if (action === "saved") onOpenSaved();
    else onHelp();
  };

  return (
    <nav className={`sidebar${collapsed ? " collapsed" : ""}`} aria-label="Primary">
      <div className="active-indicator" style={{ top: activeY }} />
      {/* brand mark at the top */}
      <button
        type="button"
        className="nav-item"
        style={{ top: 42 }}
        aria-label="New chat"
        onClick={() => run("reset")}
      >
        <PixelLogo size={26} />
      </button>
      {NAV_ITEMS.map(({ y, icon: Icon, label, id, action }) => (
        <button
          key={id}
          type="button"
          className={`nav-item${active === id ? " active" : ""}`}
          style={{ top: y }}
          aria-label={label}
          aria-current={action === "reset" && active === id ? "page" : undefined}
          onClick={() => run(action)}
        >
          <Icon size={21} strokeWidth={1.75} aria-hidden />
        </button>
      ))}
    </nav>
  );
}
