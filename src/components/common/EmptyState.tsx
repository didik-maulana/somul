import type React from 'react';
import { AudioLines, RefreshCw, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface EmptyStateAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

export interface EmptyStateProps {
  headline: string;
  subline: string;
  /** Defaults to the audio mark. Overridden when the state is about something other than sound. */
  icon?: LucideIcon;
  onRefresh?: () => void;
  /**
   * The one thing that resolves this state, when there is one.
   *
   * An empty state that explains a problem without offering its fix reads as a dead end, and a
   * dead end reads as a broken app.
   */
  action?: EmptyStateAction;
}

/**
 * Centred in the scroll region, with the text block capped at 240 px.
 *
 * The icon is a flat brand weight rather than gradient-filled. Gradient-filling a stroke icon
 * means overriding `currentColor`, and `background-clip: text` breaks the light/dark theme swap
 * along with it.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  headline,
  subline,
  icon: Icon = AudioLines,
  onRefresh,
  action,
}) => (
  <div
    data-testid="empty-state"
    className="flex flex-1 flex-col items-center justify-center gap-3.5 px-4 text-center"
  >
    <div className="relative flex size-12 items-center justify-center rounded-full bg-accent/60 p-3 shadow-xs">
      <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping opacity-25" />
      <Icon
        size={24}
        strokeWidth={1.75}
        aria-hidden="true"
        className="text-primary-stroke relative shrink-0"
      />
    </div>

    <div className="flex flex-col gap-1 items-center">
      <p className="text-title max-w-[240px] font-semibold">{headline}</p>
      <p className="text-caption text-muted-foreground max-w-[240px] leading-relaxed">{subline}</p>
    </div>

    {action && (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-1 transition-all active:scale-95"
        onClick={action.onClick}
      >
        <action.icon size={14} strokeWidth={1.75} aria-hidden="true" />
        {action.label}
      </Button>
    )}

    {onRefresh && (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="group mt-1 transition-all active:scale-95"
        onClick={onRefresh}
      >
        <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" className="transition-transform duration-300 group-hover:rotate-180" />
        Refresh list
      </Button>
    )}
  </div>
);
