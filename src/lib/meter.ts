/**
 * Peak meter math.
 *
 * Amplitude arrives from the backend as a linear scalar, which is the wrong domain to draw in: a
 * signal at half power sits at 0.5 on a linear bar and at roughly 87% of a dB one, and only the
 * second matches what the ear reports. Everything below normalises to dB first and works there.
 */

/** Where the bar reads empty. Below this, a signal is inaudible against anything else playing. */
export const METER_FLOOR_DB = -48;

/**
 * Band edges, in dB. The gradient stops in `PeakMeter` derive from these rather than repeating
 * them as percentages, so moving an edge moves its colour with it.
 *
 * There is no JS that picks a band. The ladder is one gradient across the whole track and the
 * fill reveals part of it, which is what lets the colours swap with the theme in CSS alone.
 */
export const METER_MID_DB = -18;
export const METER_WARNING_DB = -6;

export const amplitudeToDb = (amplitude: number): number => {
  if (!(amplitude > 0)) {
    return METER_FLOOR_DB;
  }

  const db = 20 * Math.log10(amplitude);

  return Math.min(0, Math.max(METER_FLOOR_DB, db));
};

/** dB to the 0-1 the bar is scaled by. Linear in dB, so the floor is 0 and unity is 1. */
export const dbToLevel = (db: number): number => {
  const level = (db - METER_FLOOR_DB) / -METER_FLOOR_DB;

  return Math.min(1, Math.max(0, level));
};

/**
 * The static channel beside the bar.
 *
 * Rounded to whole dB because the underlying figure changes thirty times a second, and a decimal
 * place turns the readout into a blur nobody can read a value out of.
 */
export const formatDb = (db: number): string => {
  if (db <= METER_FLOOR_DB) {
    return '−∞ dB';
  }

  const rounded = Math.round(db);

  return rounded === 0 ? '0 dB' : `−${Math.abs(rounded).toString()} dB`;
};
