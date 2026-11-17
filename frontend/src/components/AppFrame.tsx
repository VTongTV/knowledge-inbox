import { Menu } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";

interface AppFrameProps {
  children: ReactNode;
  /** the blurred fish layer, rendered first. */
  blurFish: ReactNode;
  /** the sharp fish layer, rendered on top with pointer-events none. */
  sharpFish: ReactNode;
  onResetChat: () => void;
  onOpenSaved: () => void;
  onHelp: () => void;
}

export function AppFrame({ children, blurFish, sharpFish, onResetChat, onOpenSaved, onHelp }: AppFrameProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="app-frame">
      <div className="app-grid" />
      <div className="app-vignette" />
      <div className="fish-blur">{blurFish}</div>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        onReset={onResetChat}
        onOpenSaved={onOpenSaved}
        onHelp={onHelp}
      />
      {collapsed && (
        <button
          type="button"
          className="collapse-tab"
          aria-label="Expand sidebar"
          onClick={() => setCollapsed(false)}
        >
          <Menu size={13} strokeWidth={2} />
        </button>
      )}
      {children}
      <div className="fish-sharp">{sharpFish}</div>
    </div>
  );
}
