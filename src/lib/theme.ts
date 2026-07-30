const DARK_QUERY = '(prefers-color-scheme: dark)';

const applyTheme = (isDark: boolean): void => {
  document.documentElement.classList.toggle('dark', isDark);
};

/**
 * Resolves the colour scheme from the OS and keeps following it.
 *
 * Called before React mounts, because the panel sits over the desktop and a light frame flashing
 * before the dark theme lands is very visible against a dark wallpaper.
 *
 * Returns a teardown for the media-query listener. The listener is what makes toggling macOS
 * appearance take effect while the app is running instead of only at next launch.
 */
export const startThemeSync = (): (() => void) => {
  const query = window.matchMedia(DARK_QUERY);

  applyTheme(query.matches);

  const handleSchemeChange = (event: MediaQueryListEvent): void => {
    applyTheme(event.matches);
  };

  query.addEventListener('change', handleSchemeChange);

  return () => {
    query.removeEventListener('change', handleSchemeChange);
  };
};
