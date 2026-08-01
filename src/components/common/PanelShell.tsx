import type React from 'react';

import { cn } from '@/lib/utils';

export interface PanelShellProps {
  header: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * The tray panel root. Fixed 360×520, `radius-2xl`, `e4` elevation plus `panel-glass`.
 *
 * `panel-glass` is the only element in the app carrying `backdrop-filter`. It tints the
 * surface and blurs the panel's own stacked content; the real wallpaper blur comes from
 * `window-vibrancy` in the Rust layer. Nesting a second blur here would cost the 60 fps meter
 * budget, and the opaque fallback must stay legible on its own — every contrast ratio in the
 * palette is measured against opaque `popover`, never against the blur.
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
      'panel-glass shadow-e4 relative flex h-[520px] w-[360px] flex-col overflow-hidden rounded-2xl',
      className,
    )}
  >
    {/* Animated circular gradient background mesh */}
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-2xl">
      <div className="animated-circular-gradient absolute -left-20 -top-20 size-72 rounded-full opacity-25 blur-3xl" />
      <div className="animated-circular-gradient-secondary absolute -bottom-24 -right-24 size-80 rounded-full opacity-20 blur-3xl" />

      {/* Concentric thick background band audio circle animation layers centered in the panel */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="audio-circle-ring audio-circle-1 absolute size-60 rounded-full blur-xs" />
        <div className="audio-circle-ring audio-circle-2 absolute size-60 rounded-full blur-xs" />
        <div className="audio-circle-ring audio-circle-3 absolute size-60 rounded-full blur-xs" />
        <div className="audio-circle-ring audio-circle-4 absolute size-60 rounded-full blur-xs" />
      </div>
    </div>

    {header}
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2">{children}</div>
    {footer}
  </div>
);
