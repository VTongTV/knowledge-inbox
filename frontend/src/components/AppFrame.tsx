import { useState } from "react";
import type { ReactNode } from "react";

import { PixelLogo } from "./PixelLogo";
import { Sidebar } from "./Sidebar";

interface AppFrameProps {
  children: ReactNode;
  onResetChat: () => void;
  onOpenSaved: () => void;
  onHelp: () => void;
}

export function AppFrame({ children, onResetChat, onOpenSaved, onHelp }: AppFrameProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="app-frame">
      <div className="aurora aurora-a" aria-hidden />
      <div className="aurora aurora-b" aria-hidden />
      <div className="aurora aurora-c" aria-hidden />
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
          <PixelLogo size={10} />
        </button>
      )}
      {children}
    </div>
  );
}
