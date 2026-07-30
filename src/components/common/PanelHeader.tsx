import type React from 'react';
import { Pin, PinOff, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SomulMark } from '@/components/common/SomulMark';

export interface PanelHeaderProps {
  isPinned: boolean;
  onPinToggle: () => void;
  onSettingsOpen: () => void;
}

/**
 * The 48 px header: bottom hairline, and the window drag region.
 *
 * The drag region is the header itself, so the two icon buttons opt out with
 * `data-tauri-drag-region="false"`. Without that the compositor swallows their clicks and the
 * buttons look broken while the panel drags instead.
 */
export const PanelHeader: React.FC<PanelHeaderProps> = ({
  isPinned,
  onPinToggle,
  onSettingsOpen,
}) => (
  <header
    data-tauri-drag-region
    className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-3"
  >
    <SomulMark size={20} className="shrink-0" />
    <span className="text-title flex-1" data-tauri-drag-region>
      Somul
    </span>

    <Button
      data-tauri-drag-region="false"
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label={isPinned ? 'Show on this desktop only' : 'Show on all desktops'}
      aria-pressed={isPinned}
      onClick={onPinToggle}
    >
      {isPinned ? <PinOff size={16} strokeWidth={1.75} /> : <Pin size={16} strokeWidth={1.75} />}
    </Button>

    <Button
      data-tauri-drag-region="false"
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label="Open settings"
      onClick={onSettingsOpen}
    >
      <Settings size={16} strokeWidth={1.75} />
    </Button>
  </header>
);
