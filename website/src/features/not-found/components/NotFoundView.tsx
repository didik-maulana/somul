"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { ArrowLeft, Bug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { NOT_FOUND, SITE } from "@/content/site";
import { AmbientWaveform } from "@/features/hero/components/AmbientWaveform";
import { MuteToggle } from "@/features/mixer/components/MuteToggle";
import { VolumeSlider } from "@/features/mixer/components/VolumeSlider";
import { EASE_DECELERATE, revealUp, springSnappy, springSoft, staggerParent } from "@/lib/motion";

const ROW_LABEL = "this page";
const UNMUTE_LEVEL = 0.6;
const RESTORE_DELAY = 1400;
const FLOAT_Y = [0, -5, 0];
const GLOW_BREATH = [1, 1.07, 1];
const CTA_PULSE = [1, 1.04, 1];

const NUMERAL_STYLE = {
  backgroundImage: "linear-gradient(0deg, #ffffff 0%, #b8cdf1 45%, #95ccdd 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
} as const;

const GLYPH_STYLE = {
  backgroundImage:
    "linear-gradient(45deg, #29368133 14.645%, #4274d933 53.536%, #95ccdd33 85.355%)",
} as const;

const numeralIn: Variants = {
  hidden: { opacity: 0, scale: 0.94, filter: "blur(14px)" },
  visible: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.8, ease: EASE_DECELERATE },
  },
};

const copySwap = {
  initial: { opacity: 0, y: 10, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -10, filter: "blur(6px)" },
} as const;

export const NotFoundView: React.FC = () => {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [volume, setVolume] = useState(0);
  const [muted, setMuted] = useState(true);

  const level = muted ? 0 : volume;
  const restored = level >= 1;
  const percent = Math.round(volume * 100);

  useEffect(() => {
    if (!restored) return;
    const timer = window.setTimeout(() => router.push("/"), RESTORE_DELAY);
    return () => window.clearTimeout(timer);
  }, [restored, router]);

  const handleVolumeChange = (value: number) => {
    setVolume(value);
    if (value > 0) setMuted(false);
  };

  const handleToggleMute = () => {
    if (!muted) {
      setMuted(true);
      return;
    }
    setMuted(false);
    if (volume === 0) setVolume(UNMUTE_LEVEL);
  };

  return (
    <section className="relative flex min-h-[calc(100svh-9rem)] flex-col items-center justify-center overflow-hidden px-5 py-24 sm:px-10">
      <div
        aria-hidden
        className="pointer-events-none absolute top-[14%] left-1/2 h-70 w-160 max-w-[90vw] -translate-x-1/2"
      >
        <motion.div
          animate={{ opacity: 0.6 + level * 0.6, scale: reduceMotion ? 1 : GLOW_BREATH }}
          transition={{
            opacity: springSoft,
            scale: { duration: 7, repeat: Infinity, ease: "easeInOut" },
          }}
          className="h-full w-full rounded-full bg-brand-600/25 blur-[60px]"
        />
      </div>

      <motion.div
        variants={staggerParent(0.1)}
        initial="hidden"
        animate="visible"
        className="relative z-10 flex w-full max-w-[500px] flex-col items-center gap-7"
      >
        <motion.div variants={numeralIn} className="relative flex w-full justify-center">
          <motion.div
            aria-hidden
            animate={{ scaleY: 0.15 + level * 0.85, opacity: 0.12 + level * 0.5 }}
            transition={springSoft}
            className="pointer-events-none absolute inset-x-0 bottom-1 origin-bottom [mask-image:linear-gradient(to_top,#000_10%,transparent_95%)]"
          >
            <AmbientWaveform bars={40} className="h-30" />
          </motion.div>

          <motion.span
            style={NUMERAL_STYLE}
            animate={{
              scale: 1 + level * 0.03,
              y: reduceMotion ? 0 : FLOAT_Y,
              filter: `brightness(${0.88 + level * 0.32})`,
            }}
            transition={{
              scale: springSoft,
              filter: springSoft,
              y: { duration: 6, repeat: Infinity, ease: "easeInOut" },
            }}
            className="relative block text-center text-[104px] leading-none font-semibold tracking-[-0.04em] sm:text-[168px]"
          >
            {NOT_FOUND.code}
          </motion.span>
        </motion.div>

        <motion.div variants={revealUp} className="flex min-h-[104px] flex-col items-center gap-3">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={restored ? "restored" : "muted"}
              initial={copySwap.initial}
              animate={copySwap.animate}
              exit={copySwap.exit}
              transition={{ duration: 0.28, ease: EASE_DECELERATE }}
              className="flex flex-col items-center gap-3"
            >
              <h1 className="text-center text-[26px] font-semibold tracking-[-0.03em] text-white sm:text-[32px]">
                {restored ? NOT_FOUND.restoredTitle : NOT_FOUND.title}
              </h1>
              <p className="max-w-[460px] text-center text-[16px] leading-[26px] text-ink-400">
                {restored ? NOT_FOUND.restoredDescription : NOT_FOUND.description}
              </p>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        <motion.div variants={revealUp} className="flex w-full flex-col items-center pt-4 pb-2">
          <motion.div
            animate={{
              borderColor: restored ? "#4274d966" : "#ffffff14",
              boxShadow: restored ? "0 0 0 4px #4274d91f" : "0 0 0 0px #4274d900",
            }}
            transition={springSoft}
            className="flex h-16 w-full max-w-[380px] items-center gap-2.5 rounded-lg border bg-ink-800/40 px-2.5 transition-colors duration-150 hover:bg-ink-800/60"
          >
            <span
              style={GLYPH_STYLE}
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[13px] font-medium text-ink-100"
            >
              ?
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-ink-100">
                  {NOT_FOUND.row}
                </span>
                <AnimatePresence initial={false}>
                  {muted ? (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={springSnappy}
                      className="shrink-0 rounded-sm border border-[#D0454C40] bg-[#D0454C1A] px-1.5 py-px text-[11px] font-medium tracking-[0.02em] text-[#E2696F]"
                    >
                      MUTED
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
              <div className="flex items-center gap-2.5">
                <MuteToggle
                  muted={muted}
                  volume={volume}
                  label={ROW_LABEL}
                  onToggle={handleToggleMute}
                />
                <VolumeSlider
                  value={volume}
                  label={ROW_LABEL}
                  dimmed={muted}
                  onChange={handleVolumeChange}
                />
                <span className="w-8 shrink-0 text-right font-mono text-[12px] font-medium tabular-nums text-ink-100">
                  {percent}%
                </span>
              </div>
            </div>
          </motion.div>

          <div className="mt-3 flex h-5 items-center">
            <AnimatePresence initial={false}>
              {restored ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-0.5 w-40 overflow-hidden rounded-full bg-white/10"
                >
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: RESTORE_DELAY / 1000, ease: "linear" }}
                    className="h-full origin-left rounded-full bg-gradient-to-r from-brand-500 to-signal-300"
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.div>

        <motion.div
          variants={revealUp}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          <motion.div
            animate={restored && !reduceMotion ? { scale: CTA_PULSE } : { scale: 1 }}
            transition={{ duration: 1.1, repeat: restored ? Infinity : 0, ease: "easeInOut" }}
            className="rounded-full"
          >
            <Button href="/" external={false}>
              <ArrowLeft size={16} strokeWidth={2} aria-hidden />
              Back to homepage
            </Button>
          </motion.div>
          <Button href={`${SITE.repo}/issues`} variant="ghost">
            <Bug size={16} strokeWidth={1.8} aria-hidden />
            Report an issue
          </Button>
        </motion.div>
      </motion.div>
    </section>
  );
};
