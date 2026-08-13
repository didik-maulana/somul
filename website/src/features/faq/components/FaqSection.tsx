"use client";

import type React from "react";
import { Accordion } from "@/components/ui/Accordion";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FAQS } from "@/content/site";

export const FaqSection: React.FC = () => (
  <Section id="faq" innerClassName="flex flex-col gap-12 lg:flex-row lg:gap-20">
    <SectionHeading
      eyebrow="FAQ"
      title="A few things people ask."
      className="lg:w-[380px] lg:shrink-0"
      titleClassName="sm:text-[2.75rem]"
    />
    <Accordion entries={FAQS} className="flex-1" />
  </Section>
);
