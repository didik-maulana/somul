"use client";

import type React from "react";
import { motion } from "motion/react";
import { MousePointerClick } from "lucide-react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Reveal } from "@/components/ui/Reveal";
import { MixerPanel } from "@/features/mixer/components/MixerPanel";
import { revealUp, staggerParent, viewportOnce } from "@/lib/motion";

interface Callout {
  id: string;
  title: string;
  body: string;
}

const CALLOUTS: Callout[] = [
  {
    id: "row",
    title: "A row appears when an app starts playing",
    body: "And only when it keeps playing. Sustained output is the entry condition, so a notification chirp never steals a row.",
  },
  {
    id: "meter",
    title: "The bar under the name is a live peak meter",
    body: "Sampled at 30 Hz straight off the render callback, with a fast rise and a slow fall — the ballistics of a real meter.",
  },
  {
    id: "mute",
    title: "Mute is instant and per app",
    body: "Gain drops to zero inside the render path. The stream keeps running, so unmuting is just as instant.",
  },
];

export const MixerShowcase: React.FC = () => (
  <section id="mixer" className="relative px-6 py-28 sm:px-10">
    <div className="mx-auto grid w-full max-w-7xl gap-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="flex flex-col gap-8">
        <motion.div
          variants={staggerParent(0.1)}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          className="flex flex-col gap-5"
        >
          <motion.div variants={revealUp}>
            <Eyebrow>The panel</Eyebrow>
          </motion.div>
          <motion.h2
            variants={revealUp}
            className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl"
          >
            This is the whole interface.
          </motion.h2>
          <motion.p variants={revealUp} className="max-w-lg text-base leading-relaxed text-ink-400">
            One panel, one row per app, nothing else. Drag a fader on the right — it behaves the way
            the real one does.
          </motion.p>
        </motion.div>

        <motion.ul
          variants={staggerParent(0.09)}
          initial="hidden"
          whileInView="visible"
          viewport={viewportOnce}
          className="flex flex-col divide-y divide-white/[0.06] border-y border-white/[0.06]"
        >
          {CALLOUTS.map((callout) => (
            <motion.li key={callout.id} variants={revealUp} className="group py-5">
              <h3 className="flex items-start gap-3 text-[15px] font-medium text-ink-100">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500 transition-transform duration-200 group-hover:scale-150" />
                {callout.title}
              </h3>
              <p className="mt-2 pl-[18px] text-sm leading-relaxed text-ink-500">{callout.body}</p>
            </motion.li>
          ))}
        </motion.ul>
      </div>

      <Reveal className="flex justify-center lg:justify-end">
        <div className="relative">
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={viewportOnce}
            transition={{ delay: 0.4 }}
            className="absolute -top-11 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-400 backdrop-blur-md"
          >
            <MousePointerClick size={13} strokeWidth={1.8} />
            drag a slider
          </motion.span>
          <MixerPanel className="w-[368px]" />
          <div className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-signal-500/15 blur-[80px]" />
        </div>
      </Reveal>
    </div>
  </section>
);
