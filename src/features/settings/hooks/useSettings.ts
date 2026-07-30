import { useCallback, useEffect, useState } from 'react';

import { getSettings, updateSettings } from '@/lib/ipc';
import { applyThemePreference } from '@/lib/theme';
import type { AppSettings } from '@/types/ipc';

export interface Settings {
  settings: AppSettings | null;
  /** Set when the OS refused the requested shortcut. Cleared on the next successful change. */
  hotkeyWarning: string | null;
  change: (settings: AppSettings) => void;
}

export const useSettings = (): Settings => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hotkeyWarning, setHotkeyWarning] = useState<string | null>(null);

  useEffect(() => {
    void getSettings()
      .then((loaded) => {
        setSettings(loaded);
        applyThemePreference(loaded.theme);
      })
      .catch(() => undefined);
  }, []);

  /**
   * Renders the *applied* settings rather than the requested ones.
   *
   * The backend rolls a rejected hotkey back to the previous one, so echoing the request would
   * show a shortcut that is not actually registered.
   */
  const change = useCallback((next: AppSettings) => {
    setSettings(next);
    applyThemePreference(next.theme);

    void updateSettings(next)
      .then((result) => {
        setSettings(result.settings);
        applyThemePreference(result.settings.theme);
        setHotkeyWarning(result.hotkeyWarning);
      })
      .catch(() => undefined);
  }, []);

  return { settings, hotkeyWarning, change };
};
