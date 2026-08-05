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
import { MixerPanel } from "@/features/mixer/components/MixerPanel";
import { DURATION, EASE_DECELERATE, springSoft } from "@/lib/motion";

const TILT_DEGREES = 7;

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
          className="flex items-center justify-end gap-4 rounded-t-xl border border-white/[0.08] border-b-transparent bg-white/[0.04] px-4 py-2 backdrop-blur-xl"
        >
          <Wifi size={14} strokeWidth={1.8} className="text-ink-400" aria-hidden />
          <BatteryFull size={16} strokeWidth={1.8} className="text-ink-400" aria-hidden />
          <Search size={14} strokeWidth={1.8} className="text-ink-400" aria-hidden />
          <span className="relative">
            <Logo className="h-6 w-6 rounded-[7px]" />
            <motion.span
              className="absolute -inset-1.5 rounded-[11px] ring-1 ring-brand-400/50"
              animate={reduceMotion ? undefined : { opacity: [0, 0.9, 0], scale: [0.9, 1.15, 1.3] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
            />
          </span>
          <span className="font-mono text-[11px] text-ink-400">09:41</span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: DURATION.slow, ease: EASE_DECELERATE, delay: 0.3 }}
          className="flex justify-end pr-6"
        >
          <MixerPanel className="-mt-px" />
        </motion.div>
      </motion.div>

      <div className="pointer-events-none absolute -inset-x-16 -bottom-24 -z-10 h-64 rounded-full bg-brand-600/25 blur-[90px]" />
    </div>
  );
};
