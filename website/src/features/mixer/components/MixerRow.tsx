"use client";

import type React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import type { DemoApp } from "@/content/types";
import { AppIcon } from "@/features/mixer/components/AppIcon";
import { MuteToggle } from "@/features/mixer/components/MuteToggle";
import { VolumeSlider } from "@/features/mixer/components/VolumeSlider";
import { DURATION, EASE_DECELERATE } from "@/lib/motion";

interface MixerRowProps {
  app: DemoApp;
  index: number;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
}

export const MixerRow: React.FC<MixerRowProps> = ({
  app,
  index,
  onVolumeChange,
  onToggleMute,
}) => (
  <motion.li
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: DURATION.slow, ease: EASE_DECELERATE, delay: 0.05 * index }}
    className="flex h-16 items-center gap-2.5 rounded-lg bg-ink-800/15 px-2.5 transition-colors duration-150 hover:bg-ink-800/35"
  >
    <AppIcon id={app.id} name={app.name} />
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "truncate text-[13px] font-medium",
            app.muted ? "text-ink-400" : "text-ink-100",
          )}
        >
          {app.name}
        </span>
        {app.muted ? (
          <span className="rounded-sm border border-[#D0454C40] bg-[#D0454C1A] px-1.5 py-px text-[11px] font-medium tracking-[0.02em] text-[#E2696F]">
            MUTED
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2.5">
        <MuteToggle
          muted={app.muted}
          volume={app.volume}
          label={app.name}
          onToggle={onToggleMute}
        />
        <VolumeSlider
          value={app.volume}
          label={app.name}
          dimmed={app.muted}
          onChange={onVolumeChange}
        />
        <span
          className={cn(
            "w-8 shrink-0 text-right font-mono text-[12px] font-medium tabular-nums",
            app.muted ? "text-ink-400" : "text-ink-100",
          )}
        >
          {Math.round(app.volume * 100)}%
        </span>
      </div>
    </div>
  </motion.li>
);
