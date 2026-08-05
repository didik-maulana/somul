import type { Transition, Variants } from "motion/react";

export const EASE_STANDARD = [0.2, 0, 0, 1] as const;
export const EASE_DECELERATE = [0.05, 0.7, 0.1, 1] as const;

export const DURATION = {
  slow: 0.32,
  reveal: 0.7,
} as const;

export const springSoft: Transition = { type: "spring", stiffness: 220, damping: 30, mass: 0.9 };
export const springSnappy: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.6 };

export const revealUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.reveal, ease: EASE_DECELERATE },
  },
};

export const revealScale: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 16 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: DURATION.reveal, ease: EASE_DECELERATE },
  },
};

export const staggerParent = (stagger = 0.08, delayChildren = 0): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren } },
});

export const viewportOnce = { once: true, amount: 0.35 } as const;
