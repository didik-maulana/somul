"use client";

import type React from "react";
import { useRef } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { cn } from "@/lib/cn";
import { springSnappy } from "@/lib/motion";

type ButtonVariant = "primary" | "ghost";

interface ButtonProps {
  href: string;
  variant?: ButtonVariant;
  className?: string;
  external?: boolean;
  children: React.ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    "gap-2 rounded-full bg-brand-600 px-6 py-3 text-sm font-medium text-white shadow-[0_1px_0_#ffffff2e,0_3px_8px_-3px_#00000070,0_8px_24px_-8px_#4274d966] hover:bg-brand-500",
  ghost:
    "gap-2 rounded-full border border-hairline bg-ink-900/72 px-6 py-3 text-sm font-medium text-ink-100 backdrop-blur-xl hover:border-white/20 hover:text-white",
};

const PULL = 0.35;

export const Button: React.FC<ButtonProps> = ({
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
        "inline-flex items-center justify-center transition-colors duration-150",
        VARIANT_CLASS[variant],
        className,
      )}
    >
      {children}
    </motion.a>
  );
};
