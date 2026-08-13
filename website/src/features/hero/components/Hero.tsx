"use client";

import type React from "react";
import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowDown, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
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
      className="relative overflow-hidden px-5 pt-28 pb-20 sm:px-10 sm:pt-32 sm:pb-28 lg:pt-40"
    >
      <div className="pointer-events-none absolute inset-0 grid-field" aria-hidden />
      <div className="pointer-events-none absolute right-[10%] bottom-[16%] h-65 w-160 rounded-full bg-brand-600/25 blur-[90px]" />
      <motion.div
        style={{ y: waveformY, opacity: waveformOpacity }}
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 opacity-30"
        aria-hidden
      >
        <AmbientWaveform bars={72} />
      </motion.div>

      <motion.div
        style={{ y: contentY }}
        className="relative mx-auto grid w-full max-w-7xl items-center gap-12 sm:gap-16 lg:grid-cols-[minmax(0,1fr)_auto]"
      >
        <div className="flex min-w-0 flex-col items-start gap-6.5">
          <HeroHeadline />

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.reveal, ease: EASE_DECELERATE, delay: 0.5 }}
            className="max-w-[600px] text-pretty text-[17px] leading-relaxed text-ink-400 sm:text-[19px]"
          >
            {SITE.description}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.reveal, ease: EASE_DECELERATE, delay: 0.62 }}
            className="flex flex-wrap items-center gap-3"
          >
            <Button href={SITE.download}>
              <ArrowDown size={16} strokeWidth={2} aria-hidden />
              Download free for macOS
            </Button>
            <Button href="#mixer" variant="ghost" external={false}>
              <Play size={16} strokeWidth={1.8} aria-hidden />
              See it in action
            </Button>
          </motion.div>
        </div>

        <div className="hidden min-w-0 lg:flex lg:justify-end">
          <MenuBarStage />
        </div>
      </motion.div>
    </section>
  );
};
