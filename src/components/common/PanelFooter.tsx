import type React from 'react';

export interface PanelFooterProps {
  activeSessionCount: number;
  hotkey: string;
}

/** Splits an accelerator so each key can render as its own `<kbd>` chip. */
const toKeys = (hotkey: string): string[] =>
  hotkey
    .split('+')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

export const PanelFooter: React.FC<PanelFooterProps> = ({ activeSessionCount, hotkey }) => (
  <footer className="border-border text-caption text-muted-foreground flex h-11 shrink-0 items-center justify-between border-t px-3">
    <span>
      {activeSessionCount} {activeSessionCount === 1 ? 'app' : 'apps'}
    </span>

    <span className="flex items-center gap-1">
      {toKeys(hotkey).map((key) => (
        <kbd
          key={key}
          className="bg-secondary border-border text-micro rounded-xs border px-1 py-0.5"
        >
          {key}
        </kbd>
      ))}
    </span>
  </footer>
);
