/** Deterministic pseudo-noise so the server and the first client frame agree. */
export const noise = (seed: number): number => {
  const value = Math.sin(seed * 127.1) * 43758.5453;
  return value - Math.floor(value);
};

export const envelope = (time: number, seed: number): number => {
  const swell = 0.5 + 0.5 * Math.sin(time * 0.9 + seed * 2.3);
  const tremor = 0.5 + 0.5 * Math.sin(time * 5.7 + seed * 5.1);
  return Math.min(1, swell * 0.7 + tremor * 0.35);
};

/** Peak meters fall slower than they rise, the way a ballistic meter behaves. */
export const smoothPeak = (previous: number, target: number): number =>
  target > previous ? previous + (target - previous) * 0.55 : previous + (target - previous) * 0.12;
