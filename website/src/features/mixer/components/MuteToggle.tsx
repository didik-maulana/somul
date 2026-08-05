"use client";

import type React from "react";
import { motion } from "motion/react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import { springSnappy } from "@/lib/motion";

interface MuteToggleProps {
  muted: boolean;
  label: string;
  onToggle: () => void;
}

export const MuteToggle: React.FC<MuteToggleProps> = ({ muted, label, onToggle }) => (
  <motion.button
    type="button"
    onClick={onToggle}
    whileTap={{ scale: 0.88 }}
    transition={springSnappy}
    aria-pressed={muted}
    aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
    className={cn(
      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors duration-150",
      muted
        ? "bg-white/[0.06] text-ink-400 hover:text-ink-200"
        : "text-ink-300 hover:bg-white/[0.06] hover:text-white",
    )}
  >
    {muted ? <VolumeX size={15} strokeWidth={1.8} /> : <Volume2 size={15} strokeWidth={1.8} />}
  </motion.button>
);
