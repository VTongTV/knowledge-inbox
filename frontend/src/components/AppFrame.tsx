import { Menu } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";

interface AppFrameProps {
  children: ReactNode;
  /** the background fish field, rendered on a single webgl canvas. */
  backgroundField: ReactNode;
  onResetChat: () => void;
  onOpenSaved: () => void;
  onHelp: () => void;
}

export function AppFrame({ children, backgroundField, onResetChat, onOpenSaved, onHelp }: AppFrameProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="app-frame">
      <div className="fish-field">{backgroundField}</div>
      <div className="app-grid" />
      <div className="app-vignette" />
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
    </div>
  );
}
