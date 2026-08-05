"use client";

import type React from "react";
import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/cn";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { STEPS } from "@/content/site";
import { SignalFlow } from "@/features/how/components/SignalFlow";

export const HowItWorks: React.FC = () => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start center", "end center"],
  });
  const lineScale = useSpring(scrollYProgress, { stiffness: 160, damping: 30, mass: 0.5 });
  const stepProgress = useTransform(scrollYProgress, [0, 1], [0, STEPS.length]);

  useMotionValueEvent(stepProgress, "change", (value) => {
    setActiveIndex(Math.min(STEPS.length - 1, Math.max(0, Math.floor(value))));
  });

  return (
    <section id="how" className="relative px-6 py-28 sm:px-10">
      <div className="mx-auto w-full max-w-7xl">
        <SectionHeading
          eyebrow="How it works"
          title="macOS has no per-app volume API. Somul builds one."
          body="Core Audio exposes no equivalent of Windows' ISimpleAudioVolume, so per-app gain has to be earned inside the audio path itself."
        />

        <div className="mt-16 grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div ref={trackRef} className="relative pl-10">
            <div className="absolute left-[13px] top-2 h-[calc(100%-1rem)] w-px bg-white/[0.07]">
              <motion.div
                className="h-full w-full origin-top bg-gradient-to-b from-brand-500 to-signal-300"
                style={{ scaleY: lineScale }}
              />
            </div>

            <ol className="flex flex-col gap-24">
              {STEPS.map((step, index) => (
                <motion.li
                  key={step.id}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.6 }}
                  transition={{ duration: 0.6 }}
                  className="relative"
                >
                  <span
                    className={cn(
                      "absolute -left-10 top-1 flex h-[27px] w-[27px] items-center justify-center rounded-full border font-mono text-[10px] transition-colors duration-300",
                      index <= activeIndex
                        ? "border-brand-400/60 bg-ink-950 text-brand-200"
                        : "border-white/10 bg-ink-950 text-ink-600",
                    )}
                  >
                    {step.index}
                  </span>
                  <h3 className="text-2xl font-medium tracking-[-0.02em] text-white">
                    {step.title}
                  </h3>
                  <p className="mt-3 max-w-xl text-base leading-relaxed text-ink-400">
                    {step.body}
                  </p>
                </motion.li>
              ))}
            </ol>
          </div>

          <div className="lg:sticky lg:top-28 lg:h-fit">
            <SignalFlow activeIndex={activeIndex} />
          </div>
        </div>
      </div>
    </section>
  );
};
