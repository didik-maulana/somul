"use client";

import type React from "react";
import { useState } from "react";
import { motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import { Github } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/ui/Logo";
import { NAV_LINKS, SITE } from "@/content/site";
import { DURATION, EASE_STANDARD } from "@/lib/motion";

const CONDENSE_AT = 24;

export const SiteNav: React.FC = () => {
  const [condensed, setCondensed] = useState(false);
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 180, damping: 30, mass: 0.4 });

  useMotionValueEvent(scrollY, "change", (value) => setCondensed(value > CONDENSE_AT));

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: DURATION.slow, ease: EASE_STANDARD }}
      className="fixed inset-x-0 top-0 z-50"
    >
      <motion.div
        className="h-px origin-left bg-gradient-to-r from-brand-500 to-signal-300"
        style={{ scaleX: progress }}
      />
      <div
        className={cn(
          "transition-colors duration-200",
          condensed && "border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl",
        )}
      >
        <nav className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-3.5 sm:px-10">
          <a href="#top" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight text-white">{SITE.name}</span>
          </a>

          <ul className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="group relative block rounded-full px-3.5 py-1.5 text-sm text-ink-400 transition-colors duration-150 hover:text-white"
                >
                  {link.label}
                  <span className="absolute inset-x-3.5 bottom-1 h-px origin-left scale-x-0 bg-brand-400 transition-transform duration-200 group-hover:scale-x-100" />
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <a
              href={SITE.repo}
              target="_blank"
              rel="noreferrer"
              aria-label="Somul on GitHub"
              className="flex h-9 w-9 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white"
            >
              <Github size={17} strokeWidth={1.7} />
            </a>
            <a
              href={SITE.download}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white px-4 py-2 text-[13px] font-medium text-ink-950 transition-transform duration-150 hover:scale-[1.03]"
            >
              Download
            </a>
          </div>
        </nav>
      </div>
    </motion.header>
  );
};
