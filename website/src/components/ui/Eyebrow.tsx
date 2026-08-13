import type React from "react";
import { cn } from "@/lib/cn";

interface EyebrowProps {
  children: React.ReactNode;
  className?: string;
}

export const Eyebrow: React.FC<EyebrowProps> = ({ children, className }) => (
  <span
    className={cn(
      "inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface-2 px-3 py-[5px] font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400",
      className,
    )}
  >
    {children}
  </span>
);
