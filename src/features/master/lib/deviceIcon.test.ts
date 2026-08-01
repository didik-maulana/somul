import { describe, expect, it } from 'vitest';

import { resolveDeviceKind } from '@/features/master/lib/deviceIcon';

describe('resolveDeviceKind', () => {
  it.each([
    ["Ronit's AirPods Pro", 'headphones'],
    ['WH-1000XM4', 'headphones'],
    ['Sony Headset', 'headphones'],
    ['KG272U P Display', 'display'],
    ['LG HDMI', 'display'],
    ['MacBook Pro Speakers', 'laptop'],
    ['Built-in Output', 'laptop'],
    ['BlackHole 2ch', 'speaker'],
  ])('reads %s as its matching kind', (deviceName, expected) => {
    expect(resolveDeviceKind(deviceName)).toBe(expected);
  });

  /** Headphones outrank the laptop rule, or AirPods paired to a MacBook would read as a laptop. */
  it('prefers the more specific match when a name satisfies two rules', () => {
    expect(resolveDeviceKind('MacBook Pro AirPods')).toBe('headphones');
  });
});
