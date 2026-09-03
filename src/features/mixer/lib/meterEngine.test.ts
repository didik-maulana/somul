import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createTrack,
  isTrackAtRest,
  publishPeaks,
  resetMeterEngine,
  stepTrack,
  subscribeToMeter,
} from '@/features/mixer/lib/meterEngine';
import { METER_FLOOR_DB } from '@/lib/meter';
import type { SessionId, SessionPeak } from '@/types/ipc';

const sessionId = (value: string): SessionId => value as SessionId;

const peak = (value: string, amplitude: number): SessionPeak => ({
  sessionId: sessionId(value),
  peak: amplitude,
});

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

const collect = (value: string): number[] => {
  const frames: number[] = [];

  subscribeToMeter(sessionId(value), (db) => {
    frames.push(db);
  });

  return frames;
};

afterEach(() => {
  resetMeterEngine();
});

describe('stepTrack', () => {
  it('takes a rise whole, so a transient is never reported quieter than it was', () => {
    const track = { ...createTrack(), db: -40, targetDb: -3 };

    expect(stepTrack(track, 1 / 60).db).toBe(-3);
  });

  it('eases a fall rather than dropping to the new sample', () => {
    const track = { ...createTrack(), db: -3, targetDb: METER_FLOOR_DB };
    const stepped = stepTrack(track, 0.1);

    expect(stepped.db).toBeGreaterThan(METER_FLOOR_DB);
    expect(stepped.db).toBeLessThan(-3);
  });

  it('never falls past the sample it is heading for', () => {
    const track = { ...createTrack(), db: -10, targetDb: -12 };

    expect(stepTrack(track, 5).db).toBe(-12);
  });

  it('does not decay across a frame the browser slept through', () => {
    const track = { ...createTrack(), db: -3, targetDb: METER_FLOOR_DB };

    expect(stepTrack(track, 10).db).toBe(stepTrack(track, 0.1).db);
  });
});

describe('isTrackAtRest', () => {
  it('is what parks the loop, so silence must qualify', () => {
    expect(isTrackAtRest(createTrack())).toBe(true);
    expect(isTrackAtRest({ ...createTrack(), targetDb: -20 })).toBe(false);
  });
});

describe('the engine', () => {
  it('delivers a frame to a subscriber the moment it joins', () => {
    const frames = collect('one');

    expect(frames).toEqual([METER_FLOOR_DB]);
  });

  it('stops feeding a listener that unsubscribed', async () => {
    const listener = vi.fn();
    const stop = subscribeToMeter(sessionId('one'), listener);

    listener.mockClear();
    stop();
    publishPeaks([peak('one', 0.9)]);

    await nextFrame();

    expect(listener).not.toHaveBeenCalled();
  });

  it('drives the bar toward a published peak', async () => {
    const frames = collect('one');

    publishPeaks([peak('one', 0.5)]);
    await nextFrame();

    expect(frames.at(-1)).toBeCloseTo(-6.02, 1);
  });

  it('forgets a session the backend stopped reporting, so a closed app frees its track', async () => {
    const frames = collect('one');

    publishPeaks([peak('one', 0.9)]);
    await nextFrame();

    const beforeItLeft = frames.length;

    publishPeaks([peak('two', 0.9)]);
    await nextFrame();

    expect(frames).toHaveLength(beforeItLeft);
  });
});
