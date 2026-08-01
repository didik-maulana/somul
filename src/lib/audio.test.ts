import { describe, expect, it } from 'vitest';

import { clampScalar, formatPercent, formatVolumeForScreenReader } from '@/lib/audio';

describe('formatPercent', () => {
  it('renders the readout shown beside a slider', () => {
    expect(formatPercent(0.74)).toBe('74%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('clamps before rounding', () => {
    expect(formatPercent(2)).toBe('100%');
    expect(formatPercent(-1)).toBe('0%');
  });
});

describe('formatVolumeForScreenReader', () => {
  it('returns a human string rather than the raw float', () => {
    expect(formatVolumeForScreenReader(0.74)).toBe('74 percent');
  });
});

describe('clampScalar', () => {
  it('treats NaN as silence', () => {
    expect(clampScalar(Number.NaN)).toBe(0);
  });
});
