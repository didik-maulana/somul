import type React from 'react';
import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SomulMark } from '@/components/common/SomulMark';

export interface PanelHeaderProps {
  onSettingsOpen: () => void;
}

/**
 * The 48 px header: bottom hairline, and the window drag region.
 *
 * The drag region is the header itself, so the two icon buttons opt out with
 * `data-tauri-drag-region="false"`. Without that the compositor swallows their clicks and the
 * buttons look broken while the panel drags instead.
 */
export const PanelHeader: React.FC<PanelHeaderProps> = ({ onSettingsOpen }) => (
  <header
    data-tauri-drag-region
    className="border-border/80 flex h-12 shrink-0 items-center gap-2.5 border-b px-3.5 backdrop-blur-md"
  >
    <div className="flex items-center gap-2" data-tauri-drag-region>
      <div className="relative flex items-center justify-center">
        <SomulMark size={22} className="shrink-0 transition-transform duration-300 hover:scale-110" />
      </div>
      <span className="text-title font-bold tracking-tight text-foreground" data-tauri-drag-region>
        Somul
      </span>
      <span
        data-tauri-drag-region
        className="text-[10px] uppercase font-semibold text-primary px-1.5 py-0.5 rounded-full bg-primary/10 tracking-wider"
      >
        Audio
      </span>
    </div>

    <div className="flex-1" data-tauri-drag-region />

    <Button
      data-tauri-drag-region="false"
      variant="ghost"
      size="icon"
      className="group size-7 rounded-md transition-colors hover:bg-accent"
      aria-label="Open settings"
      onClick={onSettingsOpen}
    >
      <Settings size={16} strokeWidth={1.75} className="transition-transform duration-500 group-hover:rotate-90 text-muted-foreground group-hover:text-foreground" />
    </Button>
  </header>
);
