import { setPanelAppearance } from '@/lib/ipc';
import type { Theme } from '@/types/ipc';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** A stored `dark` or `light` wins over the OS; `system` hands control back to it. */
let preference: Theme = 'system';

const prefersDark = (): boolean => window.matchMedia(DARK_QUERY).matches;

const resolve = (): boolean => (preference === 'system' ? prefersDark() : preference === 'dark');

/**
 * The last value pushed to the window, so an unchanged theme costs no IPC.
 *
 * `'system'` is a value of its own rather than the boolean it currently resolves to. Following
 * the system is not the same instruction as forcing the colour the system happens to want right
 * now, and collapsing the two is what left the window pinned after the OS changed.
 */
let lastPushed: 'dark' | 'light' | 'system' | null = null;

/**
 * Suppresses colour transitions across the swap itself.
 *
 * Two frames, not one: the class has to be in the stylesheet's hands before the `dark` class
 * lands, and released only after the browser has painted with the new colours.
 */
const swapInstantly = (toggleTheme: () => void): void => {
  const root = document.documentElement;

  root.classList.add('theme-instant');
  toggleTheme();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-instant');
    });
  });
};

let lastResolvedIsDark: boolean | null = null;

const apply = (): void => {
  const isDark = resolve();

  if (isDark === lastResolvedIsDark) {
    document.documentElement.classList.toggle('dark', isDark);
  } else {
    lastResolvedIsDark = isDark;
    swapInstantly(() => {
      document.documentElement.classList.toggle('dark', isDark);
    });
  }

  const next = preference === 'system' ? 'system' : isDark ? 'dark' : 'light';

  if (next === lastPushed) {
    return;
  }

  lastPushed = next;

  // The blur behind the panel follows the *window's* appearance, not the CSS. Forcing light
  // while macOS is dark would otherwise leave light content sitting on a dark surface.
  //
  // Under `system` the override is cleared instead of being set to today's answer. A forced
  // appearance also pins `prefers-color-scheme` in this WebView, so leaving one in place would
  // make `resolve()` keep reading back whatever was last forced rather than what macOS wants.
  void setPanelAppearance(next === 'system' ? null : isDark).catch(() => undefined);
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
