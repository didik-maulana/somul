import type React from 'react';

import { formatAccelerator, isApplePlatform } from '@/lib/accelerator';

export interface PanelFooterProps {
  activeSessionCount: number;
  hotkey: string;
}

export const PanelFooter: React.FC<PanelFooterProps> = ({ activeSessionCount, hotkey }) => (
  <footer className="border-border text-caption text-muted-foreground flex h-11 shrink-0 items-center justify-between border-t px-3">
    <span>
      {activeSessionCount} {activeSessionCount === 1 ? 'app' : 'apps'}
    </span>

    {/* One chip rather than one per key. The shortcut is a single thing to press, and separate
        chips read as separate options — the joining `+` is what makes it a combination. */}
    <kbd className="bg-secondary border-border text-micro rounded-xs border px-1.5 py-0.5">
      {formatAccelerator(hotkey, isApplePlatform())}
    </kbd>
  </footer>
);
