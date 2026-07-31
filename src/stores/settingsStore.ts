import { create } from 'zustand';

export type Theme = 'dark' | 'light' | 'system';

/** Mirrors `AppSettings` in `src-tauri/src/settings.rs`. Keep the two in step. */
export interface SettingsState {
  hotkey: string;
  theme: Theme;
  shouldLaunchAtLogin: boolean;
  /** Set when the hotkey could not be registered. The app stays usable through the tray. */
  hotkeyWarning: string | null;

  setHotkey: (hotkey: string) => void;
  setTheme: (theme: Theme) => void;
  setShouldLaunchAtLogin: (shouldLaunchAtLogin: boolean) => void;
  setHotkeyWarning: (hotkeyWarning: string | null) => void;
}

export const DEFAULT_HOTKEY = 'CmdOrCtrl+Shift+V';

export const useSettingsStore = create<SettingsState>()((set) => ({
  hotkey: DEFAULT_HOTKEY,
  theme: 'system',
  shouldLaunchAtLogin: false,
  hotkeyWarning: null,

  setHotkey: (hotkey) => {
    set({ hotkey });
  },
  setTheme: (theme) => {
    set({ theme });
  },
  setShouldLaunchAtLogin: (shouldLaunchAtLogin) => {
    set({ shouldLaunchAtLogin });
  },
  setHotkeyWarning: (hotkeyWarning) => {
    set({ hotkeyWarning });
  },
}));
