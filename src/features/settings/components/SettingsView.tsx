import { useState, type FC, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HotkeyRecorder } from "@/features/settings/components/HotkeyRecorder";
import { cn } from "@/lib/utils";
import type { AppSettings, Theme } from "@/types/ipc";

export interface SettingsViewProps {
  settings: AppSettings | null;
  hotkeyWarning: string | null;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const Row: FC<{ label: string; hint?: string; children: ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div className="flex items-center justify-between gap-3 py-2">
    <div className="min-w-0 flex-1">
      <p className="text-label">{label}</p>
      {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
    </div>
    {children}
  </div>
);

export const SettingsView: FC<SettingsViewProps> = ({
  settings,
  hotkeyWarning,
  onSettingsChange,
  onClose,
}) => {
  const [isRecordingHotkey, setIsRecordingHotkey] = useState(false);

  if (!settings) {
    return (
      <div data-testid="settings-loading" className="flex-1" aria-busy="true" />
    );
  }

  return (
    <div data-testid="settings-view" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Back to mixer"
          onClick={onClose}
        >
          <ChevronLeft size={16} strokeWidth={1.75} />
        </Button>
        <p className="text-title">Settings</p>
      </div>

      {/* `pr-1` leaves room for the focus ring: the scroll container clips horizontally, and a
          control flush against the right edge loses the outer pixels of its ring. */}
      <div className="divide-border flex flex-col divide-y overflow-y-auto pr-1">
        {/* The hint doubles as the way out of recording. Escape is the only exit, and a control
            that says "press keys" gives no clue that one key means cancel. */}
        <Row
          label="Shortcut"
          hint={
            isRecordingHotkey
              ? "Press Escape to cancel"
              : "Opens and closes the panel"
          }
        >
          <HotkeyRecorder
            hotkey={settings.hotkey}
            onHotkeyChange={(hotkey) => {
              onSettingsChange({ ...settings, hotkey });
            }}
            onRecordingChange={setIsRecordingHotkey}
          />
        </Row>

        <Row label="Theme" hint="System follows macOS appearance">
          <div
            role="radiogroup"
            aria-label="Theme"
            className="bg-muted relative flex shrink-0 rounded-sm p-0.5"
          >
            {/* One pill that slides, rather than a background toggling on each option. Moving a
                single element is what reads as the selection travelling; swapping backgrounds
                just blinks. Transform only, so it never triggers layout. */}
            <span
              aria-hidden="true"
              data-testid="theme-indicator"
              className="bg-card absolute inset-y-0.5 left-0.5 rounded-xs transition-transform duration-[200ms] ease-[var(--ease-decelerate)] motion-reduce:transition-none"
              style={{
                width: `calc((100% - 0.25rem) / ${THEMES.length.toString()})`,
                transform: `translateX(${(THEMES.findIndex((theme) => theme.value === settings.theme) * 100).toString()}%)`,
              }}
            />

            {THEMES.map((theme) => (
              <button
                key={theme.value}
                type="button"
                role="radio"
                aria-checked={settings.theme === theme.value}
                onClick={() => {
                  onSettingsChange({ ...settings, theme: theme.value });
                }}
                className={cn(
                  "text-caption relative z-10 rounded-xs px-2 py-1 transition-colors duration-[200ms]",
                  settings.theme === theme.value
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Launch at login" hint="Start Somul when you sign in">
          <Switch
            checked={settings.shouldLaunchAtLogin}
            aria-label="Launch at login"
            onCheckedChange={(shouldLaunchAtLogin) => {
              onSettingsChange({ ...settings, shouldLaunchAtLogin });
            }}
          />
        </Row>

        <Row label="Keep panel open" hint="Stay open when you click elsewhere">
          <Switch
            checked={settings.isPanelPinned}
            aria-label="Keep panel open"
            onCheckedChange={(isPanelPinned) => {
              onSettingsChange({ ...settings, isPanelPinned });
            }}
          />
        </Row>
      </div>

      {hotkeyWarning && (
        <p role="alert" className="text-caption text-destructive pt-2">
          {hotkeyWarning}
        </p>
      )}
    </div>
  );
};
