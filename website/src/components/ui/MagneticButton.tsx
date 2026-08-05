"use client";

import type React from "react";
import { useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { cn } from "@/lib/cn";
import { springSnappy } from "@/lib/motion";

type MagneticButtonVariant = "primary" | "ghost";

interface MagneticButtonProps {
  href: string;
  variant?: MagneticButtonVariant;
  className?: string;
  external?: boolean;
  children: React.ReactNode;
}

const VARIANT_CLASS: Record<MagneticButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-[0_18px_40px_-18px_rgba(66,116,217,0.9)] hover:bg-brand-500",
  ghost: "surface hairline text-ink-100 hover:border-white/20",
};

const PULL = 0.35;

export const MagneticButton: React.FC<MagneticButtonProps> = ({
  href,
  variant = "primary",
  className,
  external = true,
  children,
}) => {
  const ref = useRef<HTMLAnchorElement>(null);
  const reduceMotion = useReducedMotion();
  const offsetX = useMotionValue(0);
  const offsetY = useMotionValue(0);
  const x = useSpring(offsetX, springSnappy);
  const y = useSpring(offsetY, springSnappy);

  const handlePointerMove = (event: React.PointerEvent<HTMLAnchorElement>) => {
    if (reduceMotion || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    offsetX.set((event.clientX - (bounds.left + bounds.width / 2)) * PULL);
    offsetY.set((event.clientY - (bounds.top + bounds.height / 2)) * PULL);
  };

  const handlePointerLeave = () => {
    offsetX.set(0);
    offsetY.set(0);
  };

  return (
    <motion.a
      ref={ref}
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      style={{ x, y }}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "group relative inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-colors duration-150",
        VARIANT_CLASS[variant],
        className,
      )}
    >
      {children}
    </motion.a>
  );
};
