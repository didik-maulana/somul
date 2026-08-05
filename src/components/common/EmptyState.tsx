import type React from 'react';
import { RefreshCw, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface EmptyStateAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

export interface EmptyStateProps {
  headline: string;
  subline: string;
  onRefresh?: () => void;
  /**
   * The one thing that resolves this state, when there is one.
   *
   * An empty state that explains a problem without offering its fix reads as a dead end, and a
   * dead end reads as a broken app.
   */
  action?: EmptyStateAction;
  /**
   * The way back, when the primary action is a guess about what the user already did.
   *
   * Kept quieter than {@link action} on purpose: a state offering two equal buttons asks the user
   * to diagnose their own problem, which is the job the state is meant to have done for them.
   */
  secondaryAction?: EmptyStateAction;
}

/**
 * Centred in the scroll region, with the text block capped at 260 px.
 *
 * The badge carries the equaliser and nothing else. It used to take a glyph per state as well,
 * which put two symbols in one mark — and on the permission state the glyph was the same shield
 * the button below it already carried, so the same icon appeared twice in a 360 px panel. The
 * bars say "audio" for every state this panel has, and the button says what to do about it.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  headline,
  subline,
  onRefresh,
  action,
  secondaryAction,
}) => (
  <div
    data-testid="empty-state"
    className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center select-none"
  >
    {/* Floating Glass Icon Badge with Audio Motion Graphics */}
    <div className="relative flex items-center justify-center pt-2 pb-1">
      {/* Expanding Ripple Rings */}
      <div className="absolute size-20 rounded-full border border-primary/25 animate-[empty-ripple-expand_3.2s_infinite_ease-out] pointer-events-none motion-reduce:animate-none motion-reduce:opacity-0" />
      <div className="absolute size-20 rounded-full border border-info/20 animate-[empty-ripple-expand_3.2s_infinite_ease-out] [animation-delay:1.6s] pointer-events-none motion-reduce:animate-none motion-reduce:opacity-0" />

      {/* Atmospheric Ambient Glow behind Badge */}
      <div className="absolute size-16 rounded-full bg-primary/20 blur-xl animate-pulse pointer-events-none motion-reduce:animate-none" />

      {/* Main Glass Floating Card Badge */}
      <div className="group relative flex size-14 items-center justify-center rounded-full bg-card/75 border border-border/80 shadow-e2 backdrop-blur-md transition-transform duration-300 animate-[empty-state-float_4s_ease-in-out_infinite] motion-reduce:animate-none">
        {/* The equaliser is the mark now, not a texture behind one, so it is centred and sized
            to read as an icon rather than tucked into the bottom edge. */}
        <div
          aria-hidden="true"
          data-testid="empty-state-equalizer"
          className="pointer-events-none flex h-6 w-7 items-end justify-between opacity-70 transition-opacity duration-300 group-hover:opacity-100">
          <span className="w-1 h-full bg-primary-stroke rounded-full animate-[empty-wave-bounce_1.4s_infinite_ease-in-out] motion-reduce:animate-none" />
          <span className="w-1 h-full bg-primary-stroke rounded-full animate-[empty-wave-bounce_1.4s_infinite_ease-in-out] motion-reduce:animate-none [animation-delay:0.25s]" />
          <span className="w-1 h-full bg-primary-stroke rounded-full animate-[empty-wave-bounce_1.4s_infinite_ease-in-out] motion-reduce:animate-none [animation-delay:0.5s]" />
          <span className="w-1 h-full bg-primary-stroke rounded-full animate-[empty-wave-bounce_1.4s_infinite_ease-in-out] motion-reduce:animate-none [animation-delay:0.75s]" />
          <span className="w-1 h-full bg-primary-stroke rounded-full animate-[empty-wave-bounce_1.4s_infinite_ease-in-out] motion-reduce:animate-none [animation-delay:0.35s]" />
        </div>
      </div>
    </div>

    {/* Typography & Messaging */}
    <div className="flex flex-col gap-1 items-center">
      <p className="text-title max-w-[260px] font-semibold text-foreground tracking-tight">{headline}</p>
      <p className="text-caption text-muted-foreground/80 max-w-[260px] leading-relaxed">{subline}</p>
    </div>

    {/* Action Buttons */}
    {action && (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-1 transition-all duration-200 hover:scale-105 active:scale-95 shadow-xs"
        onClick={action.onClick}
      >
        <action.icon size={14} strokeWidth={1.75} aria-hidden="true" />
        {action.label}
      </Button>
    )}

    {secondaryAction && (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-mt-2 text-muted-foreground transition-colors duration-200 hover:text-foreground"
        onClick={secondaryAction.onClick}
      >
        <secondaryAction.icon size={14} strokeWidth={1.75} aria-hidden="true" />
        {secondaryAction.label}
      </Button>
    )}

    {onRefresh && (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="group mt-1 transition-all duration-200 hover:scale-105 active:scale-95 shadow-xs"
        onClick={onRefresh}
      >
        <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" className="transition-transform duration-500 ease-out group-hover:rotate-180" />
        Refresh list
      </Button>
    )}
  </div>
);
