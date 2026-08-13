"use client";

import type React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { FLOW_NODES } from "@/content/site";
import { springSoft } from "@/lib/motion";

interface SignalFlowProps {
  activeIndex: number;
}

export const SignalFlow: React.FC<SignalFlowProps> = ({ activeIndex }) => {
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex w-full max-w-[420px] flex-col gap-3 rounded-2xl border border-line-soft bg-surface-1 p-6">
      <span className="px-0.5 pb-1 font-mono text-[11px] tracking-[0.16em] text-ink-500">
        WHERE THE SOUND GOES
      </span>

      {FLOW_NODES.map((node, index) => {
        const isActive = index <= activeIndex + 1;
        const isCurrent = index === activeIndex + 1;

        return (
          <div key={node.id} className="flex flex-col gap-3">
            <motion.div
              animate={{
                borderColor: isCurrent
                  ? "rgba(66,116,217,0.55)"
                  : isActive
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(255,255,255,0.05)",
                backgroundColor: isCurrent ? "rgba(66,116,217,0.08)" : "rgba(255,255,255,0.015)",
              }}
              transition={springSoft}
              className="flex flex-col gap-1 rounded-xl border px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  className={cn(
                    "text-[13px] font-medium transition-colors duration-200",
                    isActive ? "text-ink-100" : "text-ink-600",
                  )}
                >
                  {node.label}
                </span>
                {isCurrent ? (
                  <motion.span
                    layoutId="flow-marker"
                    className="h-1.5 w-1.5 rounded-full bg-brand-400"
                  />
                ) : null}
              </div>
              <p
                className={cn(
                  "font-mono text-[11px] tracking-[0.04em] transition-colors duration-200",
                  isActive ? "text-ink-500" : "text-ink-700",
                )}
              >
                {node.hint}
              </p>
            </motion.div>

            {index < FLOW_NODES.length - 1 ? (
              <div className="relative mx-auto h-6 w-px overflow-hidden bg-hairline">
                <motion.span
                  className="absolute inset-x-0 h-3 bg-gradient-to-b from-transparent via-brand-400 to-transparent"
                  initial={{ y: -12 }}
                  animate={reduceMotion ? { y: 6, opacity: 0.4 } : { y: [-12, 24] }}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    ease: "linear",
                    delay: index * 0.25,
                  }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
