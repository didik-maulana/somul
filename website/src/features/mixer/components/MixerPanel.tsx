"use client";

import type React from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, Laptop, Settings } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { MASTER_DEVICE, SITE } from "@/content/site";
import { useMixerState } from "@/features/mixer/hooks/useMixerState";
import { MixerRow } from "@/features/mixer/components/MixerRow";
import { MuteToggle } from "@/features/mixer/components/MuteToggle";
import { VolumeSlider } from "@/features/mixer/components/VolumeSlider";

export const MixerPanel: React.FC = () => {
  const { apps, master, masterMuted, setVolume, toggleMute, setMaster, toggleMasterMute } =
    useMixerState();
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex h-130 w-90 max-w-full flex-col overflow-hidden rounded-2xl border border-ink-750/90 bg-ink-950/82 shadow-[0_16px_48px_rgba(0,0,0,0.44)] backdrop-blur-2xl">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2.5 border-b border-ink-750/80 px-3.5">
        <div className="flex items-center gap-2">
          <Logo size={22} />
          <span className="text-base font-bold tracking-[-0.025em] text-ink-100">{SITE.name}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#60A5FA4D] bg-[#3B82F633] px-2 py-0.5 text-[10px] font-semibold tracking-[0.05em] text-[#93C5FD]">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-[#60A5FA]"
              animate={reduceMotion ? undefined : { opacity: [1, 0.35, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
            AUDIO
          </span>
        </div>
        <span className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400">
          <Settings size={16} strokeWidth={1.7} aria-hidden />
        </span>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-3 py-2">
        <div className="flex flex-col gap-2.5 rounded-lg border border-ink-750 bg-ink-900/52 p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink-750/50 bg-ink-800/60 text-ink-400">
              <Laptop size={16} strokeWidth={1.7} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-100">
              {MASTER_DEVICE}
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400">
              <ChevronDown size={14} strokeWidth={1.7} aria-hidden />
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <MuteToggle
              muted={masterMuted}
              volume={master}
              label="System output"
              size={32}
              iconSize={18}
              onToggle={toggleMasterMute}
            />
            <VolumeSlider
              value={master}
              label="System output"
              tone="master"
              dimmed={masterMuted}
              onChange={setMaster}
            />
            <span className="shrink-0 font-mono text-[15px] font-medium tracking-[-0.01em] tabular-nums text-ink-100">
              {Math.round(master * 100)}%
            </span>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-1.5">
          <span className="px-1 pt-0.5 text-[11px] font-semibold tracking-[0.05em] text-ink-400/75">
            APPLICATIONS
          </span>
          <ul className="flex flex-col gap-1 pt-1">
            {apps.map((app, index) => (
              <MixerRow
                key={app.id}
                app={app}
                index={index}
                onVolumeChange={(value) => setVolume(app.id, value)}
                onToggleMute={() => toggleMute(app.id)}
              />
            ))}
          </ul>
        </div>
      </div>

      <footer className="flex h-11 shrink-0 items-center justify-between gap-2 border-t border-ink-750 px-3">
        <span className="text-[11px] font-medium tracking-[0.02em] text-ink-400/80">
          {SITE.name}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-ink-400/75">Toggle:</span>
          <kbd className="rounded-sm border border-ink-750 bg-ink-800/80 px-1.5 py-px font-mono text-[11px] font-medium text-ink-300">
            ⌘ + Shift + V
          </kbd>
        </span>
      </footer>
    </div>
  );
};
