"use client";

import type React from "react";
import { motion } from "motion/react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FEATURES } from "@/content/site";
import { FeatureCard } from "@/features/features/components/FeatureCard";
import { staggerParent } from "@/lib/motion";

export const FeatureGrid: React.FC = () => (
  <section id="features" className="relative px-6 py-28 sm:px-10">
    <div className="mx-auto w-full max-w-7xl">
      <SectionHeading
        eyebrow="Features"
        title="Small app, exact scope."
        body="Somul does one job. Everything below exists because a per-app mixer is unusable without it."
      />

      <motion.div
        variants={staggerParent(0.07)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.15 }}
        className="mt-14 grid auto-rows-[minmax(200px,auto)] gap-4 md:grid-cols-3"
      >
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.id} feature={feature} />
        ))}
      </motion.div>
    </div>
  </section>
);
