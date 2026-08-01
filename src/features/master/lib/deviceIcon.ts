export type DeviceKind = 'headphones' | 'display' | 'laptop' | 'speaker';

/**
 * The backend reports a device name and nothing else — Core Audio's transport type is not part of
 * `AudioDevice` — so the kind is inferred from the name. First match wins, and anything
 * unrecognised falls back to a plain speaker rather than guessing.
 */
const DEVICE_KIND_RULES: readonly (readonly [RegExp, DeviceKind])[] = [
  [/airpod|earbud|buds|headphone|headset|beats|\bwh-|\bhd\s?\d/i, 'headphones'],
  [/display|monitor|hdmi|projector|\btv\b/i, 'display'],
  [/macbook|laptop|built-?in|internal/i, 'laptop'],
];

export const resolveDeviceKind = (deviceName: string): DeviceKind =>
  DEVICE_KIND_RULES.find(([pattern]) => pattern.test(deviceName))?.[1] ?? 'speaker';
