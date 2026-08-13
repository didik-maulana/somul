"use client";

import type React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { revealUp, staggerParent, viewportOnce } from "@/lib/motion";
import { Eyebrow } from "@/components/ui/Eyebrow";

interface SectionHeadingProps {
  eyebrow?: string;
  title: React.ReactNode;
  body?: string;
  className?: string;
  titleClassName?: string;
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({
  eyebrow,
  title,
  body,
  className,
  titleClassName,
}) => (
  <motion.header
    variants={staggerParent(0.1)}
    initial="hidden"
    whileInView="visible"
    viewport={viewportOnce}
    className={cn("flex flex-col items-start gap-5", className)}
  >
    {eyebrow ? (
      <motion.div variants={revealUp}>
        <Eyebrow>{eyebrow}</Eyebrow>
      </motion.div>
    ) : null}
    <motion.h2
      variants={revealUp}
      className={cn(
        "text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-white sm:text-5xl",
        titleClassName,
      )}
    >
      {title}
    </motion.h2>
    {body ? (
      <motion.p variants={revealUp} className="text-pretty text-base leading-relaxed text-ink-400">
        {body}
      </motion.p>
    ) : null}
  </motion.header>
);
