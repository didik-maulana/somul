import { describe, expect, it } from 'vitest';

import { formatAccelerator } from '@/lib/accelerator';

describe('formatAccelerator', () => {
  /** Apple keyboards label the modifier with a glyph, not a word. */
  it('renders the Command glyph on Apple platforms', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+V', true)).toBe('⌘ + Shift + V');
  });

  it('spells out Ctrl everywhere else', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+V', false)).toBe('Ctrl + Shift + V');
  });

  it('joins keys with a visible plus so it reads as a combination', () => {
    expect(formatAccelerator('Alt+Shift+M', true)).toBe('Alt + Shift + M');
  });

  it('accepts the other spellings Tauri allows for the same modifier', () => {
    for (const spelling of ['CommandOrControl', 'Command', 'Cmd', 'Super', 'Meta']) {
      expect(formatAccelerator(`${spelling}+V`, true)).toBe('⌘ + V');
    }
  });

  it('leaves an unknown key untouched rather than dropping it', () => {
    expect(formatAccelerator('Alt+F4', true)).toBe('Alt + F4');
  });

  it('survives stray whitespace and empty segments', () => {
    expect(formatAccelerator(' Cmd + Shift + V ', true)).toBe('⌘ + Shift + V');
    expect(formatAccelerator('Cmd++V', true)).toBe('⌘ + V');
  });

  it('renders a single-key accelerator without a trailing plus', () => {
    expect(formatAccelerator('F12', true)).toBe('F12');
  });
});
