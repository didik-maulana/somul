"use client";

import type React from "react";
import { motion } from "motion/react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { PLATFORMS } from "@/content/site";
import type { PlatformStatus } from "@/content/types";
import { revealUp, staggerParent, viewportOnce } from "@/lib/motion";

const STATUS_CLASS: Record<PlatformStatus, string> = {
  shipping: "border-mint-500/35 bg-mint-500/10 text-mint-300",
  partial: "border-brand-400/30 bg-brand-500/10 text-brand-200",
  next: "border-white/10 bg-white/[0.03] text-ink-500",
};

export const PlatformTable: React.FC = () => (
  <section id="platforms" className="relative px-6 py-28 sm:px-10">
    <div className="mx-auto w-full max-w-7xl">
      <SectionHeading
        eyebrow="Platforms"
        title="Honest about where it works."
        body="A binary whose sliders move nothing is worse than no binary. Windows and Linux stay switched off until their audio adapters exist."
      />

      <motion.ul
        variants={staggerParent(0.08)}
        initial="hidden"
        whileInView="visible"
        viewport={viewportOnce}
        className="mt-14 flex flex-col border-t border-white/[0.07]"
      >
        {PLATFORMS.map((row) => (
          <motion.li
            key={row.id}
            variants={revealUp}
            className="group grid grid-cols-1 items-center gap-2 border-b border-white/[0.07] py-6 transition-colors duration-200 hover:bg-white/[0.02] sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] sm:gap-6"
          >
            <span className="text-[15px] font-medium text-white">{row.platform}</span>
            <span className="text-sm leading-relaxed text-ink-500">{row.detail}</span>
            <span
              className={`justify-self-start rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] sm:justify-self-end ${STATUS_CLASS[row.status]}`}
            >
              {row.statusLabel}
            </span>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  </section>
);
