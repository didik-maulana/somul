"use client";

import type React from "react";
import { useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import { Github, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/ui/Logo";
import { NAV_LINKS, SITE } from "@/content/site";
import { DURATION, EASE_DECELERATE, EASE_STANDARD } from "@/lib/motion";

const CONDENSE_AT = 24;

export const SiteNav: React.FC = () => {
  const [condensed, setCondensed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
          (condensed || menuOpen) && "border-b border-line-faint backdrop-blur-xl",
          menuOpen ? "bg-ink-950/95" : condensed && "bg-ink-950/70",
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

          <div className="flex items-center gap-1 sm:gap-2">
            <a
              href={SITE.repo}
              target="_blank"
              rel="noreferrer"
              aria-label="Somul on GitHub"
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink-400 transition-colors duration-150 hover:bg-white/6 hover:text-white"
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
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="site-nav-mobile"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink-300 transition-colors duration-150 hover:bg-white/6 hover:text-white md:hidden"
            >
              {menuOpen ? (
                <X size={19} strokeWidth={1.7} aria-hidden />
              ) : (
                <Menu size={19} strokeWidth={1.7} aria-hidden />
              )}
            </button>
          </div>
        </nav>

        <AnimatePresence initial={false}>
          {menuOpen ? (
            <motion.div
              id="site-nav-mobile"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: EASE_DECELERATE }}
              className="overflow-hidden md:hidden"
            >
              <ul className="mx-auto flex w-full max-w-7xl flex-col px-6 pb-3 sm:px-10">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className="block border-t border-line-faint py-3.5 text-[15px] text-ink-300 transition-colors duration-150 hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.header>
  );
};
