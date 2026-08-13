import type React from "react";
import { KeyCap } from "@/components/ui/KeyCap";
import { SITE } from "@/content/site";

export const HotkeyKeys: React.FC = () => (
  <div className="relative flex flex-col items-center gap-3">
    <div className="flex items-center gap-2.5">
      {SITE.hotkey.map((key) => (
        <KeyCap key={key}>{key}</KeyCap>
      ))}
    </div>
    <span className="font-mono text-[10px] tracking-[0.16em] text-ink-500">
      REBINDABLE IN SETTINGS
    </span>
  </div>
);
