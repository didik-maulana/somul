"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  command: string;
}

const RESET_DELAY = 1800;

export const CodeBlock: React.FC<CodeBlockProps> = ({ command }) => {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), RESET_DELAY);
  }, [command]);

  return (
    <div className="flex items-center justify-between gap-3 overflow-hidden rounded-lg bg-black/40 px-3 py-2.5">
      <code className="overflow-x-auto font-mono text-[12px] whitespace-nowrap text-mint-300">
        {command}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Command copied" : "Copy command"}
        className="shrink-0 text-ink-500 transition-colors duration-150 hover:text-ink-200"
      >
        {copied ? <Check size={14} strokeWidth={1.8} /> : <Copy size={14} strokeWidth={1.8} />}
      </button>
    </div>
  );
};
