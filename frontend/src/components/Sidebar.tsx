import {
  Bookmark,
  CircleHelp,
  Compass,
  History,
  PanelLeft,
  Pause,
  SquarePen,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { PixelLogo } from "./PixelLogo";

interface NavDef {
  y: number;
  icon: LucideIcon;
  label: string;
  id: string;
}

const NAV_ITEMS: NavDef[] = [
  { y: 108, icon: SquarePen, label: "New chat", id: "new-chat" },
  { y: 158, icon: History, label: "History", id: "history" },
  { y: 208, icon: Compass, label: "Explore", id: "explore" },
  { y: 257, icon: Bookmark, label: "Saved", id: "saved" },
  { y: 306, icon: Waves, label: "Flow", id: "flow" },
  { y: 481, icon: Pause, label: "Pause", id: "pause" },
  { y: 531, icon: CircleHelp, label: "Help", id: "help" },
  { y: 580, icon: PanelLeft, label: "Collapse sidebar", id: "collapse" },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const [active, setActive] = useState("new-chat");
  const activeY = NAV_ITEMS.find((i) => i.id === active)?.y ?? 108;

  return (
    <nav className={`sidebar${collapsed ? " collapsed" : ""}`} aria-label="Primary">
      <div className="active-indicator" style={{ top: activeY }} />
      {/* brand mark at the top */}
      <button
        type="button"
        className="nav-item"
        style={{ top: 42 }}
        aria-label="knowledge inbox"
        onClick={() => setActive("new-chat")}
      >
        <PixelLogo size={26} title="knowledge inbox" />
      </button>
      {NAV_ITEMS.map(({ y, icon: Icon, label, id }) => (
        <button
          key={id}
          type="button"
          className={`nav-item${active === id ? " active" : ""}`}
          style={{ top: y }}
          aria-label={label}
          aria-current={active === id ? "page" : undefined}
          onClick={() => {
            if (id === "collapse") {
              onToggle();
              return;
            }
            setActive(id);
          }}
        >
          <Icon size={21} strokeWidth={1.75} aria-hidden />
        </button>
      ))}
      <div className="avatar" style={{ top: 645 }} aria-hidden>
        <PixelLogo size={22} />
      </div>
    </nav>
  );
}
