import { describe, expect, it } from 'vitest';

import { amplitudeToDb, dbToLevel, formatDb, METER_FLOOR_DB } from '@/lib/meter';

describe('amplitudeToDb', () => {
  it('puts unity at 0 dB and half amplitude near −6', () => {
    expect(amplitudeToDb(1)).toBe(0);
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('floors silence rather than returning negative infinity', () => {
    expect(amplitudeToDb(0)).toBe(METER_FLOOR_DB);
    expect(amplitudeToDb(-1)).toBe(METER_FLOOR_DB);
    expect(amplitudeToDb(0.000001)).toBe(METER_FLOOR_DB);
  });

  it('clamps a backend that reports above unity instead of overflowing the bar', () => {
    expect(amplitudeToDb(4)).toBe(0);
  });
});

describe('dbToLevel', () => {
  it('spans the floor to unity across the whole bar', () => {
    expect(dbToLevel(METER_FLOOR_DB)).toBe(0);
    expect(dbToLevel(0)).toBe(1);
  });

  it('is linear in dB, not in amplitude', () => {
    expect(dbToLevel(METER_FLOOR_DB / 2)).toBeCloseTo(0.5, 5);
  });
});

describe('formatDb', () => {
  it('reads out whole dB, because the figure changes thirty times a second', () => {
    expect(formatDb(-6.4)).toBe('−6 dB');
    expect(formatDb(-5.6)).toBe('−6 dB');
    expect(formatDb(0)).toBe('0 dB');
  });

  it('says silence rather than printing the floor as a level', () => {
    expect(formatDb(METER_FLOOR_DB)).toBe('−∞ dB');
  });
});
