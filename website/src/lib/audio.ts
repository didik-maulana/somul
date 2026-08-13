export const noise = (seed: number): number => {
  const value = Math.sin(seed * 127.1) * 43758.5453;
  return value - Math.floor(value);
};
