"use client";

import type React from "react";
import { motion } from "motion/react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { PRIVACY_NOTE, PRIVACY_STATS } from "@/content/site";
import { revealUp, staggerParent, viewportOnce } from "@/lib/motion";

export const PrivacySection: React.FC = () => (
  <section id="privacy" className="relative px-6 py-28 sm:px-10">
    <div className="mx-auto w-full max-w-7xl overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-b from-white/[0.04] to-transparent px-8 py-16 sm:px-14">
      <motion.div
        variants={staggerParent(0.09)}
        initial="hidden"
        whileInView="visible"
        viewport={viewportOnce}
        className="flex flex-col items-center gap-6 text-center"
      >
        <motion.div variants={revealUp}>
          <Eyebrow>Privacy</Eyebrow>
        </motion.div>
        <motion.h2
          variants={revealUp}
          className="max-w-2xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl"
        >
          Your audio never leaves the process.
        </motion.h2>
        <motion.p
          variants={revealUp}
          className="max-w-2xl text-pretty text-base leading-relaxed text-ink-400"
        >
          {PRIVACY_NOTE}
        </motion.p>

        <motion.dl
          variants={staggerParent(0.08, 0.15)}
          className="mt-6 grid w-full grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.06] sm:grid-cols-4"
        >
          {PRIVACY_STATS.map((stat) => (
            <motion.div
              key={stat.id}
              variants={revealUp}
              className="flex flex-col items-center gap-1.5 bg-ink-950 px-4 py-8"
            >
              <dt className="sr-only">{stat.label}</dt>
              <dd className="font-mono text-4xl font-medium tabular-nums text-white">
                {stat.value}
              </dd>
              <span className="text-[13px] text-ink-500">{stat.label}</span>
            </motion.div>
          ))}
        </motion.dl>
      </motion.div>
    </div>
  </section>
);
