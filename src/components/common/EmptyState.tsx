import type React from 'react';
import { AudioLines, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface EmptyStateProps {
  headline: string;
  subline: string;
  onRefresh?: () => void;
}

/**
 * DESIGN.md §9.9 — centred in the scroll region, block capped at 240 px.
 *
 * The icon is a flat brand weight rather than gradient-filled: §8 forbids overriding
 * `currentColor` on a stroke icon, and `background-clip: text` would break the theme swap with it.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({ headline, subline, onRefresh }) => (
  <div
    data-testid="empty-state"
    className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
  >
    <AudioLines
      size={20}
      strokeWidth={1.75}
      aria-hidden="true"
      className="text-primary-stroke opacity-40"
    />

    <p className="text-title max-w-[240px]">{headline}</p>
    <p className="text-caption text-muted-foreground max-w-[240px]">{subline}</p>

    {onRefresh && (
      <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={onRefresh}>
        <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
        Refresh
      </Button>
    )}
  </div>
);
