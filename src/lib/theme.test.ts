import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setPanelAppearance } from '@/lib/ipc';
import { applyThemePreference, startThemeSync } from '@/lib/theme';

vi.mock('@/lib/ipc', () => ({
  setPanelAppearance: vi.fn(() => Promise.resolve()),
}));

const appearance = vi.mocked(setPanelAppearance);

/** Stands in for the OS preference, and for the listener macOS changes arrive on. */
const stubScheme = (isDark: boolean) => {
  const listeners: (() => void)[] = [];

  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: isDark,
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;

  return {
    /** Reports a new OS preference and fires the change, as WebKit does. */
    change: (nextIsDark: boolean) => {
      stubScheme(nextIsDark);
      for (const listener of listeners) {
        listener();
      }
    },
  };
};

describe('theme', () => {
  beforeEach(() => {
    appearance.mockClear();
    document.documentElement.classList.remove('dark');
    stubScheme(false);
    // Resets the module's memory of what it last pushed, which is otherwise per-import.
    applyThemePreference('light');
    appearance.mockClear();
  });

  it('forces the window dark when the user picks dark', () => {
    applyThemePreference('dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(appearance).toHaveBeenCalledWith(true);
  });

  /**
   * The bug this guards: a forced appearance also pins `prefers-color-scheme` inside the WebView.
   * Resolving `system` to today's answer and forcing *that* leaves the window overridden, so the
   * page can no longer see what macOS wants and stays on whatever was forced last.
   */
  it('hands the appearance back to macOS when the user picks system', () => {
    applyThemePreference('dark');
    appearance.mockClear();

    applyThemePreference('system');

    expect(appearance).toHaveBeenCalledWith(null);
  });

  it('follows the OS once the override is gone', () => {
    const scheme = stubScheme(false);

    startThemeSync();
    applyThemePreference('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    applyThemePreference('system');
    // The window's appearance clears asynchronously, so the truth arrives with the change event.
    scheme.change(true);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  /**
   * Surfaces take their colour from a variable and change the instant `dark` is toggled, while
   * anything carrying `transition-colors` for its hover state would ease into the new one. That
   * gap is the old theme's text sitting on the new theme's background, which reads as blinking.
   */
  it('suppresses colour transitions across the swap', () => {
    stubScheme(false);
    applyThemePreference('light');

    applyThemePreference('dark');

    expect(document.documentElement.classList.contains('theme-instant')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  /** An unchanged theme costs no IPC, and `system` counts as its own value. */
  it('pushes nothing when the preference has not moved', () => {
    applyThemePreference('system');
    appearance.mockClear();

    applyThemePreference('system');

    expect(appearance).not.toHaveBeenCalled();
  });
});
