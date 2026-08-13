import type React from "react";
import { MINI_MIXER_ROWS } from "@/content/site";
import type { MiniMixerRow } from "@/content/types";

const TONE_CLASS: Record<MiniMixerRow["tone"], string> = {
  brand: "bg-brand-400",
  mint: "bg-mint-400",
  signal: "bg-signal-400",
};

export const MiniMixer: React.FC = () => (
  <ul className="relative flex w-full max-w-[300px] flex-col gap-3.5" aria-hidden>
    {MINI_MIXER_ROWS.map((row) => (
      <li key={row.id} className="flex items-center gap-3">
        <span className="w-[70px] shrink-0 font-mono text-[10px] tracking-[0.14em] text-ink-400">
          {row.label}
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
          <span
            className={`block h-full origin-left rounded-full ${TONE_CLASS[row.tone]}`}
            style={{ transform: `scaleX(${row.value / 100})` }}
          />
        </span>
        <span className="w-5.5 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink-500">
          {row.value}
        </span>
      </li>
    ))}
  </ul>
);
