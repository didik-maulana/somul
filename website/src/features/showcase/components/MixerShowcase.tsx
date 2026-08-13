"use client";

import type React from "react";
import { motion } from "motion/react";
import { MousePointerClick } from "lucide-react";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SHOWCASE_CALLOUTS } from "@/content/site";
import { MixerPanel } from "@/features/mixer/components/MixerPanel";
import { revealUp, staggerParent, viewportOnce } from "@/lib/motion";

export const MixerShowcase: React.FC = () => (
  <Section
    id="mixer"
    innerClassName="flex flex-col items-center gap-18 lg:flex-row lg:justify-between"
  >
    <div className="pointer-events-none absolute top-[28%] left-[6%] h-75 w-115 rounded-full bg-signal-500/15 blur-[80px]" />

    <Reveal className="relative flex flex-col items-center gap-5">
      <motion.span
        initial={{ opacity: 0, y: 6 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={viewportOnce}
        transition={{ delay: 0.4 }}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-surface-3 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-400 backdrop-blur-md"
      >
        <MousePointerClick size={13} strokeWidth={1.8} aria-hidden />
        Drag a fader
      </motion.span>
      <MixerPanel />
    </Reveal>

    <div className="flex max-w-[640px] flex-col gap-8">
      <SectionHeading
        title="The whole app is one panel."
        body="One row for every app making sound. Drag a fader and that app moves. Everything else stays where you left it."
      />

      <motion.ul
        variants={staggerParent(0.09)}
        initial="hidden"
        whileInView="visible"
        viewport={viewportOnce}
        className="flex flex-col divide-y divide-line-faint border-y border-line-faint"
      >
        {SHOWCASE_CALLOUTS.map((callout) => (
          <motion.li key={callout.id} variants={revealUp} className="group flex flex-col gap-2 py-5">
            <h3 className="flex items-start gap-3 text-[15px] font-medium leading-normal text-ink-100">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500 transition-transform duration-200 group-hover:scale-150" />
              {callout.title}
            </h3>
            <p className="pl-[18px] text-sm leading-relaxed text-ink-400">{callout.body}</p>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  </Section>
);
