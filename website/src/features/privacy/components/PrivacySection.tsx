"use client";

import type React from "react";
import { motion } from "motion/react";
import {
  ChartNoAxesColumn,
  HardDrive,
  Mic,
  Radio,
  RefreshCw,
  User,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Section } from "@/components/ui/Section";
import { PRIVACY_FACTS, PRIVACY_NOTE } from "@/content/site";
import type { PrivacyFact } from "@/content/types";
import { revealUp, staggerParent, viewportOnce } from "@/lib/motion";

const ICONS: Record<string, LucideIcon> = {
  HardDrive,
  Radio,
  ChartNoAxesColumn,
  User,
  RefreshCw,
};

const TONE_CLASS: Record<PrivacyFact["tone"], string> = {
  mint: "text-mint-300",
  signal: "text-signal-300",
};

export const PrivacySection: React.FC = () => (
  <Section
    id="privacy"
    innerClassName="overflow-hidden rounded-3xl border border-line-soft bg-gradient-to-b from-white/4 to-transparent"
  >
    <motion.div
      variants={staggerParent(0.09)}
      initial="hidden"
      whileInView="visible"
      viewport={viewportOnce}
      className="flex flex-col items-start gap-10 p-6 sm:gap-14 sm:p-14 lg:flex-row lg:items-center"
    >
      <div className="flex flex-1 flex-col items-start gap-5">
        <motion.div variants={revealUp}>
          <Eyebrow>Privacy</Eyebrow>
        </motion.div>
        <motion.h2
          variants={revealUp}
          className="text-balance text-[clamp(2rem,3.5vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-white"
        >
          Yes, macOS asks for your mic.
        </motion.h2>
        <motion.p variants={revealUp} className="text-pretty text-base leading-relaxed text-ink-400">
          {PRIVACY_NOTE}
        </motion.p>
        <motion.p
          variants={revealUp}
          className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-300"
        >
          <Mic size={14} strokeWidth={1.8} className="shrink-0 text-mint-400" aria-hidden />
          The only permission Somul ever asks for
        </motion.p>
      </div>

      <motion.div
        variants={revealUp}
        className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-line-soft bg-surface-1"
      >
        <h3 className="px-5.5 pt-5 pb-3.5 font-mono text-[11px] tracking-[0.16em] text-ink-500">
          What Somul does with your audio
        </h3>
        <dl>
          {PRIVACY_FACTS.map((fact, index) => {
            const Icon = ICONS[fact.icon] ?? HardDrive;

            return (
              <div
                key={fact.id}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-x-3.5 gap-y-1 px-5 py-4 sm:px-5.5",
                  index > 0 && "border-t border-line-faint",
                )}
              >
                <dt className="flex items-center gap-2.75 text-sm text-ink-300">
                  <Icon size={15} strokeWidth={1.7} className="shrink-0 text-ink-500" aria-hidden />
                  {fact.label}
                </dt>
                <dd className={cn("font-mono text-sm tracking-[0.02em]", TONE_CLASS[fact.tone])}>
                  {fact.value}
                </dd>
              </div>
            );
          })}
        </dl>
      </motion.div>
    </motion.div>
  </Section>
);
