"use client";

import type React from "react";
import { motion } from "motion/react";
import { ArrowDown, Github } from "lucide-react";
import { MagneticButton } from "@/components/ui/MagneticButton";
import { AmbientWaveform } from "@/features/hero/components/AmbientWaveform";
import { SITE } from "@/content/site";
import { revealUp, staggerParent, viewportOnce } from "@/lib/motion";

export const DownloadSection: React.FC = () => (
  <section className="relative overflow-hidden px-6 pb-32 pt-20 sm:px-10">
    <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 opacity-25" aria-hidden>
      <AmbientWaveform bars={40} />
    </div>

    <motion.div
      variants={staggerParent(0.09)}
      initial="hidden"
      whileInView="visible"
      viewport={viewportOnce}
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-7 text-center"
    >
      <motion.h2
        variants={revealUp}
        className="text-balance text-[clamp(2.4rem,5vw,3.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-white"
      >
        Eleven megabytes. <span className="text-gradient">One job.</span>
      </motion.h2>
      <motion.p variants={revealUp} className="max-w-xl text-base leading-relaxed text-ink-400">
        Free and MIT licensed. Grab the DMG, drop it in Applications, and the panel is in your menu
        bar.
      </motion.p>
      <motion.div variants={revealUp} className="flex flex-wrap items-center justify-center gap-3">
        <MagneticButton href={SITE.download}>
          <ArrowDown size={16} strokeWidth={2} />
          Download Somul {SITE.version}
        </MagneticButton>
        <MagneticButton href={SITE.repo} variant="ghost">
          <Github size={16} strokeWidth={1.8} />
          Read the source
        </MagneticButton>
      </motion.div>
      <motion.p
        variants={revealUp}
        className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-600"
      >
        {SITE.requirement}
      </motion.p>

      {/* Not a footnote. Somul is not notarized yet, so macOS refuses to open it rather than
          merely warning, and a download that will not launch reads as a broken app rather than a
          missing signature. Whoever ships this page owes the reader that sentence before they
          spend a click. */}
      <motion.div
        variants={revealUp}
        className="mt-2 w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-left"
      >
        <p className="text-sm leading-relaxed text-ink-400">
          Somul is not notarized yet, so macOS will refuse to open it the first time. After
          dragging it to Applications, run this once:
        </p>
        <code className="mt-3 block overflow-x-auto rounded-lg bg-black/40 px-3 py-2 font-mono text-[12px] text-ink-200">
          xattr -dr com.apple.quarantine /Applications/Somul.app
        </code>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-600">
          Notarization needs a paid Apple developer account, which this project does not have yet.
          Prefer not to run a command? Open System Settings, Privacy &amp; Security, then choose
          Open Anyway.
        </p>
      </motion.div>
    </motion.div>
  </section>
);
