"use client";

import type React from "react";
import { motion } from "motion/react";
import { revealUp, viewportOnce } from "@/lib/motion";

interface RevealProps {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export const Reveal: React.FC<RevealProps> = ({ children, delay = 0, className }) => (
  <motion.div
    variants={revealUp}
    initial="hidden"
    whileInView="visible"
    viewport={viewportOnce}
    transition={{ delay }}
    className={className}
  >
    {children}
  </motion.div>
);
