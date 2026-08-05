"use client";

import type React from "react";
import { useRef } from "react";
import { motion, useMotionTemplate, useMotionValue } from "motion/react";
import {
  AudioLines,
  Command,
  Gauge,
  PanelTop,
  Save,
  ShieldCheck,
  SlidersVertical,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Feature } from "@/content/types";
import { revealScale } from "@/lib/motion";

const ICONS: Record<string, LucideIcon> = {
  SlidersVertical,
  PanelTop,
  AudioLines,
  Command,
  Save,
  ShieldCheck,
  Gauge,
};

const SPAN_CLASS: Record<string, string> = {
  wide: "md:col-span-2",
  tall: "md:row-span-2",
};

interface FeatureCardProps {
  feature: Feature;
}

export const FeatureCard: React.FC<FeatureCardProps> = ({ feature }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const spotlight = useMotionTemplate`radial-gradient(340px circle at ${pointerX}px ${pointerY}px, rgba(66,116,217,0.16), transparent 70%)`;
  const Icon = ICONS[feature.icon] ?? SlidersVertical;

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = cardRef.current?.getBoundingClientRect();
    if (!bounds) return;
    pointerX.set(event.clientX - bounds.left);
    pointerY.set(event.clientY - bounds.top);
  };

  return (
    <motion.div
      ref={cardRef}
      variants={revealScale}
      onPointerMove={handlePointerMove}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 transition-colors duration-200 hover:border-white/15",
        feature.span ? SPAN_CLASS[feature.span] : undefined,
      )}
    >
      <motion.div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: spotlight }}
        aria-hidden
      />
      <span className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-brand-300">
        <Icon size={18} strokeWidth={1.7} />
      </span>
      <h3 className="relative mt-5 text-[17px] font-medium tracking-[-0.01em] text-white">
        {feature.title}
      </h3>
      <p className="relative mt-2.5 text-sm leading-relaxed text-ink-500">{feature.body}</p>
    </motion.div>
  );
};
