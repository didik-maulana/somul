"use client";

import type React from "react";
import { motion } from "motion/react";
import { ArrowDown, Github } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SITE } from "@/content/site";
import { AmbientWaveform } from "@/features/hero/components/AmbientWaveform";
import { revealUp, staggerParent, viewportOnce } from "@/lib/motion";

export const DownloadSection: React.FC = () => (
  <section className="relative overflow-hidden px-5 pt-16 pb-32 sm:px-10 sm:pt-20 sm:pb-46">
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
        Download once. <span className="text-gradient">Tune everything.</span>
      </motion.h2>
      <motion.p variants={revealUp} className="max-w-xl text-base leading-relaxed text-ink-300">
        Free, no account, no setup. It lives in your menu bar.
      </motion.p>
      <motion.div variants={revealUp} className="flex flex-wrap items-center justify-center gap-3">
        <Button href={SITE.download}>
          <ArrowDown size={16} strokeWidth={2} aria-hidden />
          Download Somul v{SITE.version}
        </Button>
        <Button href={SITE.repo} variant="ghost">
          <Github size={16} strokeWidth={1.8} aria-hidden />
          Read the source
        </Button>
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
