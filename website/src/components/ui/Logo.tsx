"use client";

import type React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

const BASE_SIZE = 36;
const BAR_HEIGHTS = [10, 18, 28, 16, 8];

interface LogoProps {
  size?: number;
  plain?: boolean;
  animate?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ size = BASE_SIZE, plain = false, animate = true }) => {
  const reduceMotion = useReducedMotion();
  const isLive = animate && !reduceMotion;
  const scale = size / BASE_SIZE;

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden",
        !plain && "border border-hairline bg-ink-900",
      )}
      style={{
        width: size,
        height: size,
        gap: 3 * scale,
        borderRadius: plain ? 0 : 10 * scale,
      }}
      aria-hidden
    >
      {plain ? null : (
        <span className="absolute inset-0 bg-gradient-to-br from-brand-800/40 via-brand-500/20 to-signal-300/20" />
      )}
      {BAR_HEIGHTS.map((height, index) => (
        <motion.span
          key={index}
          className={cn(
            "relative",
            plain ? "bg-ink-200" : "bg-gradient-to-b from-signal-300 to-brand-500",
          )}
          style={{
            width: 3 * scale,
            height: height * scale,
            borderRadius: 1.5 * scale,
          }}
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
