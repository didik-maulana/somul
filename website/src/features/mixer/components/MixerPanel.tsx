"use client";

import type React from "react";
import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Settings2, Volume1 } from "lucide-react";
import { cn } from "@/lib/cn";
import { SITE } from "@/content/site";
import { useMeterEngine } from "@/features/mixer/hooks/useMeterEngine";
import { useMixerState } from "@/features/mixer/hooks/useMixerState";
import { MixerRow } from "@/features/mixer/components/MixerRow";
import { VolumeSlider } from "@/features/mixer/components/VolumeSlider";

interface MixerPanelProps {
  className?: string;
}

export const MixerPanel: React.FC<MixerPanelProps> = ({ className }) => {
  const { apps, master, setVolume, toggleMute, setMaster } = useMixerState();
  const panelRef = useRef<HTMLDivElement>(null);
  const inView = useInView(panelRef, { amount: 0.2 });
  const reduceMotion = useReducedMotion();
  const levels = useMeterEngine(apps, inView && !reduceMotion);

  return (
    <div
      ref={panelRef}
      className={cn(
        "w-[336px] max-w-full rounded-[18px] border border-white/10 bg-ink-900/85 p-3 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl",
        className,
      )}
    >
      <header className="flex items-center justify-between px-1.5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold tracking-tight text-white">{SITE.name}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-mint-500/30 px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.12em] text-mint-300">
            <motion.span
              className="h-1.5 w-1.5 rounded-full bg-mint-400"
              animate={reduceMotion ? undefined : { opacity: [1, 0.35, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
            live
          </span>
        </div>
        <Settings2 size={15} strokeWidth={1.7} className="text-ink-500" aria-hidden />
      </header>

      <div className="rounded-xl bg-white/[0.03] px-2.5 py-2">
        <div className="flex items-center gap-2.5">
          <Volume1 size={16} strokeWidth={1.7} className="text-ink-400" aria-hidden />
          <span className="flex-1 text-[13px] font-medium text-ink-200">System output</span>
          <span className="font-mono text-[11px] tabular-nums text-ink-500">
            {Math.round(master * 100)}%
          </span>
        </div>
        <VolumeSlider value={master} accent="#9aa1b4" label="System output" onChange={setMaster} />
      </div>

      <ul className="mt-1 flex flex-col">
        {apps.map((app, index) => (
          <MixerRow
            key={app.id}
            app={app}
            index={index}
            level={levels[app.id] ?? 0}
            onVolumeChange={(value) => setVolume(app.id, value)}
            onToggleMute={() => toggleMute(app.id)}
          />
        ))}
      </ul>

      <footer className="mt-1.5 flex items-center justify-between border-t border-white/[0.06] px-1.5 pt-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-600">
          {apps.length} apps playing
        </span>
        <kbd className="rounded-[5px] border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-ink-400">
          ⌘⇧V
        </kbd>
      </footer>
    </div>
  );
};
