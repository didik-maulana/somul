"use client";

import type React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { DURATION, EASE_DECELERATE, staggerParent } from "@/lib/motion";

const LINES: string[][] = [
  ["Turn", "down", "Spotify."],
  ["Not", "the", "whole", "Mac."],
];

const GRADIENT_FROM_WORD = 1;

const word = {
  hidden: { opacity: 0, y: "0.6em", filter: "blur(6px)" },
  visible: {
    opacity: 1,
    y: "0em",
    filter: "blur(0px)",
    transition: { duration: DURATION.reveal, ease: EASE_DECELERATE },
  },
};

export const HeroHeadline: React.FC = () => (
  <motion.h1
    variants={staggerParent(0.07, 0.1)}
    initial="hidden"
    animate="visible"
    className="text-[clamp(2.25rem,5.4vw,4.5rem)] font-semibold leading-[1.04] tracking-[-0.04em] text-white"
  >
    {LINES.map((line, lineIndex) => (
      <span key={lineIndex} className="block overflow-hidden pb-[0.06em]">
        {line.map((text, wordIndex) => (
          <motion.span
            key={`${text}-${wordIndex}`}
            variants={word}
            className={cn(
              "inline-block",
              wordIndex < line.length - 1 && "mr-[0.24em]",
              lineIndex === 1 && wordIndex >= GRADIENT_FROM_WORD && "text-gradient",
            )}
          >
            {text}
          </motion.span>
        ))}
      </span>
    ))}
  </motion.h1>
);
