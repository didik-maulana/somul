import type React from 'react';

import { cn } from '@/lib/utils';

export interface PanelShellProps {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * DESIGN.md §9.1 — the tray panel root. Fixed 360×520, `radius-2xl`, `e4` + `panel-glass`.
 *
 * `panel-glass` is the only element in the app carrying `backdrop-filter` (§6). It tints the
 * surface and blurs the panel's own stacked content; the real wallpaper blur comes from
 * `window-vibrancy` in the Rust layer. Nesting a second blur here would cost the 60 fps meter
 * budget, and the opaque fallback must stay legible on its own — contrast in §2.8 is measured
 * against opaque `popover`, never against the blur.
 */
export const PanelShell: React.FC<PanelShellProps> = ({
  header,
  footer,
  children,
  className,
}) => (
  <div
    data-testid="panel-shell"
    className={cn(
      'panel-glass shadow-e4 flex h-[520px] w-[360px] flex-col overflow-hidden rounded-2xl',
      className,
    )}
  >
    {header}
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2">{children}</div>
    {footer}
  </div>
);
