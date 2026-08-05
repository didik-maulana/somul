import type React from 'react';

import { formatAccelerator, isApplePlatform } from '@/lib/accelerator';

export interface PanelFooterProps {
  hotkey: string;
  /** The running build, read from the app itself. Absent only until that read comes back. */
  version?: string | null;
}

export const PanelFooter: React.FC<PanelFooterProps> = ({ hotkey, version }) => (
  <footer className="border-border text-caption text-muted-foreground flex h-11 shrink-0 items-center justify-between border-t px-3">
    <div className="flex items-center gap-1.5">
      <span className="text-micro text-muted-foreground/80 font-medium">Somul</span>
      {/* No fallback version. A hardcoded one goes stale the first time the app updates itself,
          and a footer confidently naming the wrong build is worse than a footer naming none. */}
      {version && (
        <span className="text-micro text-muted-foreground/50 font-mono">v{version}</span>
      )}
    </div>

    <div className="flex items-center gap-1.5" title="Shortcut to show or hide Somul panel">
      <span className="text-micro text-muted-foreground/75 font-normal">Toggle:</span>
      <kbd className="bg-secondary/80 border-border card-raised text-micro rounded-xs border px-1.5 py-0.5 font-mono font-medium transition-colors hover:text-foreground">
        {formatAccelerator(hotkey, isApplePlatform())}
      </kbd>
    </div>
  </footer>
);
