"use client";

import type React from "react";
import { motion } from "motion/react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import { springSnappy } from "@/lib/motion";

interface MuteToggleProps {
  muted: boolean;
  volume: number;
  label: string;
  size?: number;
  iconSize?: number;
  onToggle: () => void;
}

const HALF_VOLUME = 0.5;

export const MuteToggle: React.FC<MuteToggleProps> = ({
  muted,
  volume,
  label,
  size = 28,
  iconSize = 16,
  onToggle,
}) => {
  const Icon = muted ? VolumeX : volume < HALF_VOLUME ? Volume1 : Volume2;

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      whileTap={{ scale: 0.88 }}
      transition={springSnappy}
      aria-pressed={muted}
      aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
      style={{ width: size, height: size }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded transition-colors duration-150 hover:bg-white/6",
        muted ? "text-[#E2696F]" : "text-ink-400 hover:text-ink-100",
      )}
    >
      <Icon size={iconSize} strokeWidth={1.8} />
    </motion.button>
  );
};
