"use client";

import type React from "react";
import { motion } from "motion/react";
import { ArrowDown, Github } from "lucide-react";
import { MagneticButton } from "@/components/ui/MagneticButton";
import { AmbientWaveform } from "@/features/hero/components/AmbientWaveform";
import { SITE } from "@/content/site";
import { revealUp, staggerParent, viewportOnce } from "@/lib/motion";

export const DownloadSection: React.FC = () => (
  <section className="relative overflow-hidden px-6 pb-32 pt-20 sm:px-10">
    <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 opacity-25" aria-hidden>
      <AmbientWaveform bars={40} />
    </div>

    <motion.div
      variants={staggerParent(0.09)}
      initial="hidden"
      whileInView="visible"
      viewport={viewportOnce}
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-7 text-center"
    >
      <motion.h2
        variants={revealUp}
        className="text-balance text-[clamp(2.4rem,5vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-white"
      >
        Six megabytes. <span className="text-gradient">One job.</span>
      </motion.h2>
      <motion.p variants={revealUp} className="max-w-xl text-base leading-relaxed text-ink-400">
        Free and MIT licensed. Grab the DMG, drop it in Applications, and the panel is in your menu
        bar.
      </motion.p>
      <motion.div variants={revealUp} className="flex flex-wrap items-center justify-center gap-3">
        <MagneticButton href={SITE.download}>
          <ArrowDown size={16} strokeWidth={2} />
          Download Somul {SITE.version}
        </MagneticButton>
        <MagneticButton href={SITE.repo} variant="ghost">
          <Github size={16} strokeWidth={1.8} />
          Read the source
        </MagneticButton>
      </motion.div>
      <motion.p
        variants={revealUp}
        className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-600"
      >
        {SITE.requirement}
      </motion.p>
    </motion.div>
  </section>
);
