import { useState, type FC, type ReactNode } from "react";
import { Bug, ChevronLeft, Code, Globe, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { HotkeyRecorder } from "@/features/settings/components/HotkeyRecorder";
import { ThemeSwitcher } from "@/features/settings/components/ThemeSwitcher";
import { UpdateAction } from "@/features/update/components/UpdateAction";
import { describeUpdate } from "@/features/update/lib/describeUpdate";
import type { UpdateStatus } from "@/features/update/types";
import type { AboutLink } from "@/lib/ipc";
import type { AppSettings } from "@/types/ipc";

export interface SettingsViewProps {
  settings: AppSettings | null;
  hotkeyWarning: string | null;
  updateStatus: UpdateStatus;
  onSettingsChange: (settings: AppSettings) => void;
  onOpenAudioPermission: () => void;
  onUpdateCheck: () => void;
  onUpdateInstall: () => void;
  onUpdateRestart: () => void;
  onOpenAboutLink: (link: AboutLink) => void;
  onClose: () => void;
}

const ABOUT_LINKS: { link: AboutLink; label: string; Icon: typeof Globe }[] = [
  { link: "website", label: "Website", Icon: Globe },
  { link: "source", label: "Source code", Icon: Code },
  { link: "issues", label: "Report an issue", Icon: Bug },
];

const Row: FC<{ label: string; hint?: string; children: ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <div className="group flex items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 transition-all duration-200 ease-out hover:bg-accent/40 border border-transparent hover:border-border/50">
    <div className="min-w-0 flex-1">
      <p className="text-label group-hover:text-foreground transition-colors duration-150">{label}</p>
      {hint && <p className="text-caption text-muted-foreground transition-colors duration-150">{hint}</p>}
    </div>
    {children}
  </div>
);

export const SettingsView: FC<SettingsViewProps> = ({
  settings,
  hotkeyWarning,
  updateStatus,
  onSettingsChange,
  onOpenAudioPermission,
  onUpdateCheck,
  onUpdateInstall,
  onUpdateRestart,
  onOpenAboutLink,
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
          className="group size-7 shrink-0 transition-transform active:scale-90"
          aria-label="Back to mixer"
          onClick={onClose}
        >
          <ChevronLeft size={16} strokeWidth={1.75} className="transition-transform duration-200 group-hover:-translate-x-0.5" />
        </Button>
        <p className="text-title">Settings</p>
      </div>

      {/* `pr-1` leaves room for the focus ring: the scroll container clips horizontally, and a
          control flush against the right edge loses the outer pixels of its ring. */}
      <div className="flex flex-col gap-1.5 overflow-y-auto pr-1 py-1">
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

        {/* Always here, whatever the permission currently is.
            
            Somul cannot tell a withheld permission from a Mac where nothing happens to be playing:
            macOS reports an app as running output when it merely holds an output stream open, so
            an emulator and a silenced app look identical to one Somul is being refused. Every
            attempt to guess ended up accusing users whose permission was already granted.
            
            So the panel stops guessing and leaves a door instead. A row that claims nothing cannot
            be wrong, and it is where someone looks when per-app sliders never appear. */}
        <Row
          label="Audio permission"
          hint="Per-app mixing needs macOS's audio-capture permission"
        >
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="shrink-0 transition-transform active:scale-95"
            onClick={onOpenAudioPermission}
          >
            <ShieldCheck size={12} strokeWidth={2} aria-hidden="true" />
            Open Settings
          </Button>
        </Row>

        {/* Somul ships outside the App Store, so this row is the only way a user ever moves off
            the build they installed. */}
        <Row label="Updates" hint={describeUpdate(updateStatus)}>
          <UpdateAction
            status={updateStatus}
            onCheck={onUpdateCheck}
            onInstall={onUpdateInstall}
            onRestart={onUpdateRestart}
          />
        </Row>

        {/* Icons rather than three labelled buttons: the panel is 360px wide, and a row whose
            control takes half of it stops reading as a row. The version itself is not repeated
            here — the footer carries it on every screen, including this one. */}
        <Row label="About" hint="Free and open source">
          <div className="flex shrink-0 items-center gap-0.5">
            {ABOUT_LINKS.map(({ link, label, Icon }) => (
              <Button
                key={link}
                type="button"
                variant="ghost"
                size="icon-xs"
                title={label}
                aria-label={label}
                className="transition-transform active:scale-95"
                onClick={() => {
                  onOpenAboutLink(link);
                }}
              >
                <Icon size={12} strokeWidth={2} aria-hidden="true" />
              </Button>
            ))}
          </div>
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
