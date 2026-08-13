"use client";

import type React from "react";
import { motion, useReducedMotion } from "motion/react";
import { noise } from "@/lib/audio";
import { cn } from "@/lib/cn";

interface AmbientWaveformProps {
  bars?: number;
  className?: string;
}

export const AmbientWaveform: React.FC<AmbientWaveformProps> = ({ bars = 56, className }) => {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={cn("flex h-40 w-full items-end justify-between gap-[3px]", className)}
      aria-hidden
    >
      {Array.from({ length: bars }, (_, index) => {
        const seed = noise(index + 1);
        const height = (12 + seed * 88).toFixed(2);
        return (
          <motion.span
            key={index}
            className="flex-1 origin-bottom rounded-t-full bg-gradient-to-t from-brand-600/0 via-brand-500/40 to-signal-300/70"
            style={{ height: `${height}%` }}
            initial={{ scaleY: 0.2, opacity: 0 }}
            animate={
              reduceMotion
                ? { scaleY: 0.6, opacity: 0.5 }
                : { scaleY: [0.25, 1, 0.45, 0.85, 0.3], opacity: 1 }
            }
            transition={
              reduceMotion
                ? { duration: 0.3 }
                : {
                    duration: 3.6 + seed * 2.4,
                    repeat: Infinity,
                    repeatType: "mirror",
                    ease: "easeInOut",
                    delay: seed * 1.6,
                  }
            }
          />
        );
      })}
    </div>
  );
};
