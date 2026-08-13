import type React from "react";

interface KeyCapProps {
  children: React.ReactNode;
}

export const KeyCap: React.FC<KeyCapProps> = ({ children }) => (
  <kbd className="flex h-13 min-w-13 items-center justify-center rounded-xl border border-hairline bg-surface-2 px-3.5 font-mono text-lg font-medium text-ink-100">
    {children}
  </kbd>
);
