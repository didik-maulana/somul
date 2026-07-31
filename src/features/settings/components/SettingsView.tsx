import { useState, type FC, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HotkeyRecorder } from "@/features/settings/components/HotkeyRecorder";
import { ThemeSwitcher } from "@/features/settings/components/ThemeSwitcher";
import type { AppSettings } from "@/types/ipc";

export interface SettingsViewProps {
  settings: AppSettings | null;
  hotkeyWarning: string | null;
  onSettingsChange: (settings: AppSettings) => void;
  onClose: () => void;
}

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
          <ThemeSwitcher
            theme={settings.theme}
            onThemeChange={(theme) => {
              onSettingsChange({ ...settings, theme });
            }}
          />
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
      </div>

      {hotkeyWarning && (
        <p role="alert" className="text-caption text-destructive pt-2">
          {hotkeyWarning}
        </p>
      )}
    </div>
  );
};
