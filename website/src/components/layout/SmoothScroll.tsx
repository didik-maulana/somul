"use client";

import type React from "react";
import { useEffect } from "react";
import Lenis from "lenis";

const NAV_OFFSET = -88;

export const SmoothScroll: React.FC = () => {
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lenis = prefersReducedMotion ? null : new Lenis({ duration: 1.05, smoothWheel: true });
    let frame = 0;

    if (lenis) {
      const raf = (time: number) => {
        lenis.raf(time);
        frame = requestAnimationFrame(raf);
      };
      frame = requestAnimationFrame(raf);
    }

    const handleClick = (event: MouseEvent) => {
      const isPlainClick =
        event.button === 0 &&
        !event.defaultPrevented &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey;
      if (!isPlainClick) return;

      const href = (event.target as Element | null)?.closest("a")?.getAttribute("href");
      if (!href?.startsWith("#") || href.length < 2) return;

      const target = document.getElementById(href.slice(1));
      if (!target) return;

      event.preventDefault();
      window.history.replaceState(null, "", href);

      if (lenis) {
        lenis.scrollTo(target, { offset: NAV_OFFSET });
        return;
      }
      target.scrollIntoView();
    };

    document.addEventListener("click", handleClick);

    return () => {
      document.removeEventListener("click", handleClick);
      cancelAnimationFrame(frame);
      lenis?.destroy();
    };
  }, []);

  return null;
};
