/**
 * Meter and volume math.
 *
 * Volume and peak are linear scalars 0.0–1.0 everywhere on the wire. dB is a **presentation
 * concern only** — no value produced here may be sent back over IPC.
 */

/** Meter band boundaries, in dBFS. */
export const METER_BAND_DB = {
  midFloor: -18,
  warningFloor: -6,
  clipFloor: -1,
} as const;

/** How long the clip hold marker stays before it decays. */
export const CLIP_HOLD_MS = 1200;

/**
 * Fall smoothing belongs in the meter's own math rather than a CSS transition, which would smear
 * the signal. 24 dB/s is slow enough to read and fast enough to track a gate.
 */
export const PEAK_DECAY_DB_PER_SECOND = 24;

export type MeterBand = 'floor' | 'mid' | 'warning' | 'clip';

export const clampScalar = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
};

/** Linear amplitude to dBFS. Silence is `-Infinity`, which the UI renders as `−∞`. */
export const scalarToDb = (scalar: number): number => {
  const clamped = clampScalar(scalar);

  if (clamped === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return 20 * Math.log10(clamped);
};

/** dBFS back to linear amplitude. `-Infinity` is silence. */
export const dbToScalar = (db: number): number => {
  if (db === Number.NEGATIVE_INFINITY) {
    return 0;
  }

  return clampScalar(10 ** (db / 20));
};

/**
 * A scalar→dB→scalar round trip lands a boundary value a few ULPs off, which would let
 * -1.0 dB read as clipping. The tolerance keeps a band edge from being decided by float noise.
 */
const BAND_EPSILON_DB = 1e-9;

/** Band colours come from CSS tokens; this only decides which band a level falls in. */
export const meterBand = (scalar: number): MeterBand => {
  const db = scalarToDb(scalar);

  if (db > METER_BAND_DB.clipFloor + BAND_EPSILON_DB) {
    return 'clip';
  }

  if (db > METER_BAND_DB.warningFloor + BAND_EPSILON_DB) {
    return 'warning';
  }

  if (db > METER_BAND_DB.midFloor + BAND_EPSILON_DB) {
    return 'mid';
  }

  return 'floor';
};

/**
 * Instant attack, smoothed release.
 *
 * A meter that decays linearly in amplitude falls fast at the top and crawls at the bottom, so
 * the fall is computed in dB — the same reason hardware meters specify release in dB/s.
 */
export const decayPeak = (previous: number, incoming: number, elapsedMs: number): number => {
  const target = clampScalar(incoming);
  const current = clampScalar(previous);

  if (target >= current) {
    return target;
  }

  if (elapsedMs <= 0 || current === 0) {
    return current;
  }

  const fallenDb = scalarToDb(current) - (PEAK_DECAY_DB_PER_SECOND * elapsedMs) / 1000;

  return Math.max(target, dbToScalar(fallenDb));
};

/** `-Infinity` renders as `−∞`. Both signs use U+2212 minus, not an ASCII hyphen. */
export const formatDb = (scalar: number): string => {
  const db = scalarToDb(scalar);

  if (db === Number.NEGATIVE_INFINITY) {
    return '−∞ dB';
  }

  return `${db.toFixed(1).replace('-', '−')} dB`;
};

export const formatPercent = (scalar: number): string =>
  `${Math.round(clampScalar(scalar) * 100).toString()}%`;

/** Sliders expose a human string to screen readers, not the raw float. */
export const formatVolumeForScreenReader = (scalar: number): string =>
  `${Math.round(clampScalar(scalar) * 100).toString()} percent`;
