import { describe, expect, it } from 'vitest';

import {
  CLIP_HOLD_MS,
  clampScalar,
  dbToScalar,
  decayPeak,
  formatDb,
  formatPercent,
  formatVolumeForScreenReader,
  meterBand,
  PEAK_DECAY_DB_PER_SECOND,
  scalarToDb,
} from '@/lib/audio';

describe('scalarToDb', () => {
  it('maps silence to negative infinity', () => {
    expect(scalarToDb(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('maps unity to 0 dB', () => {
    expect(scalarToDb(1)).toBe(0);
  });

  it('maps half amplitude to about -6 dB', () => {
    expect(scalarToDb(0.5)).toBeCloseTo(-6.02, 2);
  });

  it('clamps an out-of-range scalar before converting', () => {
    expect(scalarToDb(4)).toBe(0);
    expect(scalarToDb(-1)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('dbToScalar', () => {
  it('maps negative infinity to silence', () => {
    expect(dbToScalar(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('maps 0 dB to unity', () => {
    expect(dbToScalar(0)).toBe(1);
  });

  it('round trips with scalarToDb', () => {
    for (const scalar of [0.05, 0.25, 0.5, 0.74, 1]) {
      expect(dbToScalar(scalarToDb(scalar))).toBeCloseTo(scalar, 6);
    }
  });
});

describe('meterBand', () => {
  it('reports the floor band below -18 dB', () => {
    expect(meterBand(dbToScalar(-60))).toBe('floor');
    expect(meterBand(dbToScalar(-18.1))).toBe('floor');
    expect(meterBand(0)).toBe('floor');
  });

  it('reports the mid band between -18 and -6 dB', () => {
    expect(meterBand(dbToScalar(-17.9))).toBe('mid');
    expect(meterBand(dbToScalar(-12))).toBe('mid');
    expect(meterBand(dbToScalar(-6.1))).toBe('mid');
  });

  it('reports the warning band between -6 and -1 dB', () => {
    expect(meterBand(dbToScalar(-5.9))).toBe('warning');
    expect(meterBand(dbToScalar(-3))).toBe('warning');
    expect(meterBand(dbToScalar(-1.1))).toBe('warning');
  });

  it('reports the clip band above -1 dB', () => {
    expect(meterBand(dbToScalar(-0.9))).toBe('clip');
    expect(meterBand(1)).toBe('clip');
  });

  it('places each boundary in the lower band', () => {
    expect(meterBand(dbToScalar(-18))).toBe('floor');
    expect(meterBand(dbToScalar(-6))).toBe('mid');
    expect(meterBand(dbToScalar(-1))).toBe('warning');
  });
});

describe('decayPeak', () => {
  it('rises instantly so a transient is never missed', () => {
    expect(decayPeak(0.1, 0.9, 33)).toBe(0.9);
  });

  it('falls by the documented dB rate over one second', () => {
    const fallen = decayPeak(1, 0, 1000);

    expect(scalarToDb(fallen)).toBeCloseTo(-PEAK_DECAY_DB_PER_SECOND, 4);
  });

  it('falls proportionally over a single 30 Hz frame', () => {
    const frameMs = 1000 / 30;
    const fallen = decayPeak(1, 0, frameMs);

    expect(scalarToDb(fallen)).toBeCloseTo((-PEAK_DECAY_DB_PER_SECOND * frameMs) / 1000, 4);
  });

  it('never falls below the incoming level', () => {
    expect(decayPeak(0.8, 0.6, 10_000)).toBe(0.6);
  });

  it('holds when no time has passed', () => {
    expect(decayPeak(0.8, 0.2, 0)).toBe(0.8);
  });

  it('stays at silence once it arrives', () => {
    expect(decayPeak(0, 0, 33)).toBe(0);
  });

  it('clamps an out-of-range previous value', () => {
    expect(decayPeak(4, 0.5, 0)).toBe(1);
  });

  it('decays monotonically toward silence', () => {
    let level = 1;
    let previous = Number.POSITIVE_INFINITY;

    for (let frame = 0; frame < 30; frame += 1) {
      level = decayPeak(level, 0, 1000 / 30);
      expect(level).toBeLessThan(previous);
      previous = level;
    }

    expect(level).toBeLessThan(0.1);
  });
});

describe('formatDb', () => {
  it('renders silence as the infinity glyph', () => {
    expect(formatDb(0)).toBe('−∞ dB');
  });

  it('renders unity as 0.0 dB', () => {
    expect(formatDb(1)).toBe('0.0 dB');
  });

  it('uses a real minus sign rather than a hyphen', () => {
    const rendered = formatDb(0.25);

    expect(rendered).toBe('−12.0 dB');
    expect(rendered).not.toContain('-');
  });
});

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

describe('CLIP_HOLD_MS', () => {
  it('holds a clip marker for 1.2 seconds', () => {
    expect(CLIP_HOLD_MS).toBe(1200);
  });
});
