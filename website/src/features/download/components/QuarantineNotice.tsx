import type React from "react";
import { Terminal } from "lucide-react";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { SITE } from "@/content/site";

const STEP_ONE = "Drag Somul.app into your Applications folder.";
const STEP_TWO = "Run this once in Terminal — macOS blocks unnotarized apps on first open:";

const StepBadge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface-3 font-mono text-[11px] text-ink-300">
    {children}
  </span>
);

export const QuarantineNotice: React.FC = () => (
  <div className="flex w-full max-w-[576px] flex-col gap-4 rounded-[20px] border border-white/10 bg-surface-2 px-5.5 py-5 text-left">
    <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-ink-300">
      <Terminal size={14} strokeWidth={1.8} aria-hidden />
      FIRST LAUNCH · 2 STEPS
    </span>

    <ol className="flex flex-col gap-3.5">
      <li className="flex gap-3">
        <StepBadge>1</StepBadge>
        <p className="flex-1 text-sm leading-relaxed text-ink-200">{STEP_ONE}</p>
      </li>
      <li className="flex gap-3">
        <StepBadge>2</StepBadge>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <p className="text-sm leading-relaxed text-ink-200">{STEP_TWO}</p>
          <CodeBlock command={SITE.quarantineCommand} />
        </div>
      </li>
    </ol>

    <div className="flex flex-col gap-1.5 border-t border-hairline pt-3.5">
      <span className="font-mono text-[10px] tracking-[0.16em] text-ink-500">
        OR, WITHOUT TERMINAL
      </span>
      <p className="text-[13px] leading-relaxed text-ink-300">
        System Settings → Privacy &amp; Security → Open Anyway
      </p>
    </div>
  </div>
);
