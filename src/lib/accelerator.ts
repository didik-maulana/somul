/**
 * Turns an accelerator string like `CmdOrCtrl+Shift+V` into what a person expects to read.
 *
 * Apple keyboards label the modifier with a glyph, not a word, so `CmdOrCtrl` renders as ⌘ there
 * and as `Ctrl` everywhere else. This is a presentation choice about key labelling — it must
 * never be used to decide what the app can do, which is what platform capabilities are for.
 */
const APPLE_KEY_GLYPHS: Record<string, string> = {
  cmdorctrl: '⌘',
  commandorcontrol: '⌘',
  command: '⌘',
  cmd: '⌘',
  super: '⌘',
  meta: '⌘',
};

const PORTABLE_KEY_LABELS: Record<string, string> = {
  cmdorctrl: 'Ctrl',
  commandorcontrol: 'Ctrl',
  command: 'Ctrl',
  cmd: 'Ctrl',
  super: 'Win',
  meta: 'Win',
};

const labelForKey = (key: string, isApplePlatform: boolean): string => {
  const lookup = isApplePlatform ? APPLE_KEY_GLYPHS : PORTABLE_KEY_LABELS;

  return lookup[key.toLowerCase()] ?? key;
};

/** `CmdOrCtrl+Shift+V` becomes `⌘ + Shift + V` on Apple platforms, `Ctrl + Shift + V` elsewhere. */
export const formatAccelerator = (accelerator: string, isApplePlatform: boolean): string =>
  accelerator
    .split('+')
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => labelForKey(key, isApplePlatform))
    .join(' + ');

/**
 * Whether to use Apple key glyphs.
 *
 * Reads the user agent, which is only acceptable because the answer affects nothing but how a
 * modifier key is drawn. Anything about what the app can *do* comes from the backend's reported
 * capabilities instead.
 */
export const isApplePlatform = (): boolean => /Mac|iPhone|iPad/.test(navigator.userAgent);
