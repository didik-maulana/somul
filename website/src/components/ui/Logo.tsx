"use client";

import type React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

const BAR_HEIGHTS = [10, 18, 28, 16, 8];

interface LogoProps {
  className?: string;
  animate?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ className, animate = true }) => {
  const reduceMotion = useReducedMotion();
  const isLive = animate && !reduceMotion;

  return (
    <span
      className={cn(
        "relative flex h-9 w-9 items-center justify-center gap-[3px] overflow-hidden rounded-[10px] bg-ink-900 hairline",
        className,
      )}
      aria-hidden
    >
      <span className="absolute inset-0 bg-gradient-to-br from-brand-800/40 via-brand-500/20 to-signal-300/20" />
      {BAR_HEIGHTS.map((height, index) => (
        <motion.span
          key={index}
          className="relative w-[3px] rounded-full bg-gradient-to-b from-signal-300 to-brand-500"
          style={{ height }}
          animate={isLive ? { scaleY: [1, 0.45, 1.15, 0.7, 1] } : undefined}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            ease: "easeInOut",
            delay: index * 0.14,
          }}
        />
      ))}
    </span>
  );
};
