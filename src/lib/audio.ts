/**
 * Volume math.
 *
 * Volume is a linear scalar 0.0-1.0 everywhere on the wire. Nothing here formats for the panel
 * beyond the two strings the slider needs.
 */

export const clampScalar = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
};

export const formatPercent = (scalar: number): string =>
  `${Math.round(clampScalar(scalar) * 100).toString()}%`;

/** Sliders expose a human string to screen readers, not the raw float. */
export const formatVolumeForScreenReader = (scalar: number): string =>
  `${Math.round(clampScalar(scalar) * 100).toString()} percent`;
