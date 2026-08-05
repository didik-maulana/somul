"use client";

import type React from "react";
import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowDown, Github } from "lucide-react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { MagneticButton } from "@/components/ui/MagneticButton";
import { SITE } from "@/content/site";
import { AmbientWaveform } from "@/features/hero/components/AmbientWaveform";
import { HeroHeadline } from "@/features/hero/components/HeroHeadline";
import { MenuBarStage } from "@/features/hero/components/MenuBarStage";
import { DURATION, EASE_DECELERATE } from "@/lib/motion";

export const Hero: React.FC = () => {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const waveformY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const waveformOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const contentY = useTransform(scrollYProgress, [0, 1], [0, -60]);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden px-6 pb-28 pt-32 sm:px-10 lg:pt-40"
    >
      <div className="pointer-events-none absolute inset-0 grid-field" aria-hidden />
      <motion.div
        style={{ y: waveformY, opacity: waveformOpacity }}
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 opacity-30"
        aria-hidden
      >
        <AmbientWaveform bars={72} />
      </motion.div>

      <motion.div
        style={{ y: contentY }}
        className="relative mx-auto grid w-full max-w-7xl items-center gap-16 lg:grid-cols-[minmax(0,1fr)_auto]"
      >
        <div className="flex flex-col items-start gap-7">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.slow, ease: EASE_DECELERATE }}
          >
            <Eyebrow>
              <span className="h-1.5 w-1.5 rounded-full bg-mint-400" />
              {SITE.expansion} · v{SITE.version}
            </Eyebrow>
          </motion.div>

          <HeroHeadline />

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.reveal, ease: EASE_DECELERATE, delay: 0.5 }}
            className="max-w-xl text-pretty text-lg leading-relaxed text-ink-400"
          >
            {SITE.description}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.reveal, ease: EASE_DECELERATE, delay: 0.62 }}
            className="flex flex-wrap items-center gap-3"
          >
            <MagneticButton href={SITE.download}>
              <ArrowDown size={16} strokeWidth={2} />
              Download for macOS
            </MagneticButton>
            <MagneticButton href={SITE.repo} variant="ghost">
              <Github size={16} strokeWidth={1.8} />
              Source on GitHub
            </MagneticButton>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DURATION.reveal, delay: 0.8 }}
            className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-600"
          >
            {SITE.requirement}
          </motion.p>
        </div>

        <div className="flex justify-center lg:justify-end">
          <MenuBarStage />
        </div>
      </motion.div>
    </section>
  );
};
