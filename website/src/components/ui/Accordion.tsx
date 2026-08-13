"use client";

import type React from "react";
import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { EASE_DECELERATE } from "@/lib/motion";

export interface AccordionEntry {
  id: string;
  question: string;
  answer: string;
}

interface AccordionProps {
  entries: AccordionEntry[];
  className?: string;
}

export const Accordion: React.FC<AccordionProps> = ({ entries, className }) => {
  const baseId = useId();
  const [openId, setOpenId] = useState(entries[0]?.id ?? "");

  return (
    <div className={cn("flex flex-col", className)}>
      {entries.map((entry) => {
        const isOpen = entry.id === openId;
        const panelId = `${baseId}-${entry.id}`;

        return (
          <div key={entry.id} className="border-t border-line-faint">
            <h3>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? "" : entry.id)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className="flex w-full items-center justify-between gap-6 py-6 text-left text-[19px] font-semibold tracking-[-0.015em] text-white"
              >
                {entry.question}
                <ChevronDown
                  size={18}
                  strokeWidth={1.8}
                  aria-hidden
                  className={cn(
                    "shrink-0 text-ink-400 transition-transform duration-200",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  id={panelId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: EASE_DECELERATE }}
                  className="overflow-hidden"
                >
                  <p className="pb-6 pr-30 text-base leading-relaxed text-ink-400">
                    {entry.answer}
                  </p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};
