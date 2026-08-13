"use client";

import type React from "react";
import { motion, useReducedMotion } from "motion/react";
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
    "gap-2 rounded-full bg-brand-600 px-6 py-3 text-sm font-medium text-white shadow-[0_1px_0_#ffffff2e,0_3px_8px_-3px_#00000070,0_8px_24px_-8px_#4274d966] hover:bg-brand-500 hover:shadow-[0_1px_0_#ffffff38,0_6px_14px_-4px_#00000080,0_14px_32px_-10px_#4274d980]",
  ghost:
    "gap-2 rounded-full border border-hairline bg-ink-900/72 px-6 py-3 text-sm font-medium text-ink-100 backdrop-blur-xl hover:border-white/20 hover:bg-ink-900/85 hover:text-white",
};

/* The button grows in place rather than chasing the cursor, so its box stays predictable.
   1.02 on the widest CTA adds ~2px per side — well inside the 12px gap between neighbours. */
const HOVER = { scale: 1.02, y: -1 };
const TAP = { scale: 0.98, y: 0 };

export const Button: React.FC<ButtonProps> = ({
  href,
  variant = "primary",
  className,
  external = true,
  children,
}) => {
  const reduceMotion = useReducedMotion();

  return (
    <motion.a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      whileHover={reduceMotion ? undefined : HOVER}
      whileTap={reduceMotion ? undefined : TAP}
      transition={springSnappy}
      className={cn(
        "inline-flex items-center justify-center will-change-transform",
        "transition-[background-color,border-color,color,box-shadow] duration-200 ease-out",
        VARIANT_CLASS[variant],
        className,
      )}
    >
      {children}
    </motion.a>
  );
};
