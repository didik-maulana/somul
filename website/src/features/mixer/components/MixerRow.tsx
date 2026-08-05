"use client";

import type React from "react";
import { motion } from "motion/react";
import type { DemoApp } from "@/content/types";
import { AppGlyph } from "@/features/mixer/components/AppGlyph";
import { MuteToggle } from "@/features/mixer/components/MuteToggle";
import { PeakMeter } from "@/features/mixer/components/PeakMeter";
import { VolumeSlider } from "@/features/mixer/components/VolumeSlider";
import { DURATION, EASE_DECELERATE } from "@/lib/motion";

interface MixerRowProps {
  app: DemoApp;
  level: number;
  index: number;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
}

export const MixerRow: React.FC<MixerRowProps> = ({
  app,
  level,
  index,
  onVolumeChange,
  onToggleMute,
}) => (
  <motion.li
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: DURATION.slow, ease: EASE_DECELERATE, delay: 0.05 * index }}
    className="rounded-xl px-2.5 py-2 transition-colors duration-150 hover:bg-white/[0.035]"
  >
    <div className="flex items-center gap-2.5">
      <AppGlyph name={app.name} accent={app.accent} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-ink-100">{app.name}</span>
          <span className="font-mono text-[11px] tabular-nums text-ink-500">
            {app.muted ? "muted" : `${Math.round(app.volume * 100)}%`}
          </span>
        </div>
        <PeakMeter level={app.muted ? 0 : level} accent={app.accent} className="mt-1.5" />
      </div>
      <MuteToggle muted={app.muted} label={app.name} onToggle={onToggleMute} />
    </div>
    <VolumeSlider
      value={app.volume}
      accent={app.accent}
      label={app.name}
      dimmed={app.muted}
      onChange={onVolumeChange}
    />
  </motion.li>
);
