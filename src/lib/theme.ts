import type { Theme } from '@/types/ipc';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** A stored `dark` or `light` wins over the OS; `system` hands control back to it. */
let preference: Theme = 'system';

const prefersDark = (): boolean => window.matchMedia(DARK_QUERY).matches;

const resolve = (): boolean => (preference === 'system' ? prefersDark() : preference === 'dark');

const apply = (): void => {
  document.documentElement.classList.toggle('dark', resolve());
};

/**
 * Sets the user's explicit choice, overriding the OS preference until it is set back to
 * `system`. Called once settings load, and again on every change.
 */
export const applyThemePreference = (next: Theme): void => {
  preference = next;
  apply();
};

/**
 * Resolves the colour scheme and keeps following the OS.
 *
 * Called before React mounts, because the panel sits over the desktop and a light frame flashing
 * before the dark theme lands is very visible against a dark wallpaper. Settings load later and
 * override this if the user picked something explicit.
 *
 * Returns a teardown for the media-query listener. The listener is what makes toggling macOS
 * appearance take effect while the app is running instead of only at next launch — and it does
 * nothing while an explicit preference is in force.
 */
export const startThemeSync = (): (() => void) => {
  const query = window.matchMedia(DARK_QUERY);

  apply();

  const handleSchemeChange = (): void => {
    apply();
  };

  query.addEventListener('change', handleSchemeChange);

  return () => {
    query.removeEventListener('change', handleSchemeChange);
  };
};
