"use client";

import type React from "react";
import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/cn";
import { Section } from "@/components/ui/Section";
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
    <Section id="how">
      <SectionHeading
        eyebrow="How it works"
        title="Your Mac has one volume. Somul gives each app its own."
        body="Turn a game down without turning your music down with it. No system settings to dig through, no cables to route."
        className="max-w-[700px]"
      />

      <div className="mt-16 flex flex-col items-start gap-14 lg:flex-row lg:items-center">
        <div ref={trackRef} className="relative flex-1 pl-10">
          <div className="absolute top-2 left-[13px] h-[calc(100%-1rem)] w-px bg-white/7">
            <motion.div
              className="h-full w-full origin-top bg-gradient-to-b from-brand-500 to-signal-300"
              style={{ scaleY: lineScale }}
            />
          </div>

          <ol className="flex flex-col gap-11">
            {STEPS.map((step, index) => (
              <motion.li
                key={step.id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.6 }}
                className="relative flex flex-col gap-3"
              >
                <span
                  className={cn(
                    "absolute top-1 -left-10 flex h-[27px] w-[27px] items-center justify-center rounded-full border bg-ink-950 font-mono text-[10px] transition-colors duration-300",
                    index <= activeIndex
                      ? "border-brand-400/60 text-brand-200"
                      : "border-white/10 text-ink-600",
                  )}
                >
                  {step.index}
                </span>
                <h3 className="text-2xl font-medium tracking-[-0.02em] text-white">{step.title}</h3>
                <p className="max-w-xl text-base leading-relaxed text-ink-400">{step.body}</p>
              </motion.li>
            ))}
          </ol>
        </div>

        <SignalFlow activeIndex={activeIndex} />
      </div>
    </Section>
  );
};
