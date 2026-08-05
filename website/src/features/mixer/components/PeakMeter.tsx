"use client";

import type React from "react";
import { cn } from "@/lib/cn";

interface PeakMeterProps {
  level: number;
  accent: string;
  className?: string;
}

/* No CSS transition: the meter is sampled at 30 Hz and easing between samples smears the signal. */
export const PeakMeter: React.FC<PeakMeterProps> = ({ level, accent, className }) => (
  <div className={cn("h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]", className)}>
    <div
      className="h-full rounded-full will-change-transform"
      style={{
        width: "100%",
        transform: `scaleX(${Math.min(1, level)})`,
        transformOrigin: "left",
        background: `linear-gradient(90deg, #4e7d7c 0%, #3b7b92 55%, ${accent} 100%)`,
      }}
    />
  </div>
);
