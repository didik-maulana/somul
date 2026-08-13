"use client";

import type React from "react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FEATURE_FADER, FEATURE_HOTKEY, FEATURES } from "@/content/site";
import { FeatureBody } from "@/features/features/components/FeatureBody";
import { FeatureCard } from "@/features/features/components/FeatureCard";
import { HotkeyKeys } from "@/features/features/components/HotkeyKeys";
import { MiniMixer } from "@/features/features/components/MiniMixer";
import { staggerParent } from "@/lib/motion";

const [MENU_BAR_FEATURE, MEMORY_FEATURE, MASTER_FEATURE] = FEATURES;

export const FeatureGrid: React.FC = () => (
  <Section id="features">
    <SectionHeading
      eyebrow="Features"
      title="Small app. Exactly enough."
      body="Every one of these is here because you would miss it. Nothing else ships."
      className="max-w-[672px]"
    />

    <motion.div
      variants={staggerParent(0.07)}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      className="mt-10 flex flex-col gap-4 sm:mt-14"
    >
      <div className="grid gap-4 lg:grid-cols-[848fr_416fr]">
        <Card className="flex flex-col items-center gap-8 p-6 sm:flex-row">
          <FeatureBody feature={FEATURE_FADER} className="flex-1" />
          <MiniMixer />
        </Card>
        <FeatureCard feature={MENU_BAR_FEATURE} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FeatureCard feature={MEMORY_FEATURE} />
        <FeatureCard feature={MASTER_FEATURE} />
      </div>

      <Card className="flex flex-col items-center justify-between gap-8 px-7 py-6 sm:flex-row">
        <FeatureBody feature={FEATURE_HOTKEY} className="max-w-[560px]" />
        <HotkeyKeys />
      </Card>
    </motion.div>
  </Section>
);
