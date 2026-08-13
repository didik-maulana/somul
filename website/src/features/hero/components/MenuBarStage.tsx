"use client";

import type React from "react";
import { useRef } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { BatteryFull, Search, Wifi } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { SITE } from "@/content/site";
import { AppleGlyph } from "@/features/hero/components/AppleGlyph";
import { MixerPanel } from "@/features/mixer/components/MixerPanel";
import { DURATION, EASE_DECELERATE, springSoft } from "@/lib/motion";

const TILT_DEGREES = 7;
const MENU_CLOCK = "Mon 6 Jan 1:36 PM";

export const MenuBarStage: React.FC = () => {
  const stageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const tiltX = useSpring(useMotionValue(0), springSoft);
  const tiltY = useSpring(useMotionValue(0), springSoft);
  const transform = useMotionTemplate`perspective(1400px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || !stageRef.current) return;
    const bounds = stageRef.current.getBoundingClientRect();
    const relativeX = (event.clientX - bounds.left) / bounds.width - 0.5;
    const relativeY = (event.clientY - bounds.top) / bounds.height - 0.5;
    tiltY.set(relativeX * TILT_DEGREES * 2);
    tiltX.set(-relativeY * TILT_DEGREES);
  };

  const handlePointerLeave = () => {
    tiltX.set(0);
    tiltY.set(0);
  };

  return (
    <div
      ref={stageRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="relative w-full max-w-[520px]"
    >
      <motion.div style={{ transform }} className="relative">
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_DECELERATE, delay: 0.15 }}
          className="flex items-center justify-between gap-2.5 rounded-t-xl border border-b-0 border-hairline bg-surface-3 px-3 py-1.5 backdrop-blur-xl"
        >
          <span className="flex items-center gap-2.5 text-ink-50">
            <AppleGlyph />
            <span className="text-[11px] font-bold">{SITE.name}</span>
          </span>
          <span className="flex items-center gap-2 text-ink-200">
            <span className="relative flex">
              <Logo size={16} plain />
              <motion.span
                className="absolute -inset-1 rounded-md ring-1 ring-brand-400/50"
                animate={
                  reduceMotion ? undefined : { opacity: [0, 0.9, 0], scale: [0.9, 1.15, 1.3] }
                }
                transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
                aria-hidden
              />
            </span>
            <span className="flex items-center gap-1">
              <span className="text-[11px]">97%</span>
              <BatteryFull size={17} strokeWidth={1.6} aria-hidden />
            </span>
            <Wifi size={15} strokeWidth={1.6} aria-hidden />
            <Search size={14} strokeWidth={1.6} aria-hidden />
            <span className="text-[11px] text-ink-100">{MENU_CLOCK}</span>
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: DURATION.slow, ease: EASE_DECELERATE, delay: 0.3 }}
          className="flex justify-end pr-6"
        >
          <MixerPanel />
        </motion.div>
      </motion.div>

      <div className="pointer-events-none absolute -inset-x-16 -bottom-24 -z-10 h-64 rounded-full bg-brand-600/25 blur-[90px]" />
    </div>
  );
};
