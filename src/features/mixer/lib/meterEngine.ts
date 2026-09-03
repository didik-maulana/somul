/**
 * One rAF loop for every meter on screen.
 *
 * The backend publishes peaks at 30 Hz, which is below the display's refresh rate and would show
 * as a bar that steps rather than moves. The fix is not a faster backend — it is to treat each
 * batch as a target and let the frontend draw the travel toward it every frame. Attack is
 * instant so nothing is under-reported; only the fall is smoothed.
 *
 * Nothing here touches React. Listeners write to the DOM directly, because a store update at
 * 30 Hz across every row is the one thing the panel's frame budget cannot absorb — see the note
 * on `AudioStoreState`.
 */

import { amplitudeToDb, METER_FLOOR_DB } from '@/lib/meter';
import type { SessionId, SessionPeak } from '@/types/ipc';

/** Receives the level to draw, in dB. */
export type MeterListener = (db: number) => void;

/**
 * How fast the bar falls, in dB per second. Full scale in roughly 0.6 s.
 *
 * Broadcast PPM ballistics fall 20 dB in 1.7 s, which is tuned for a needle a metre away. Tried at
 * 32 dB/s here and it read as a bar floating free of the audio: against music the transients
 * arrive faster than a 1.5 s full-scale fall can clear, so the bar never came back down far
 * enough between them to look like it was tracking anything.
 */
const FALL_DB_PER_SECOND = 80;

/**
 * A gap longer than this is a webview that was parked, not a slow frame.
 *
 * Clamped inside `stepTrack` rather than at the call site so no caller can skip it. Decaying
 * across the real gap would drop every bar to the floor the moment the panel came back, which
 * reads as the audio having stopped while it was hidden.
 */
const MAX_FRAME_SECONDS = 0.1;

export interface MeterTrack {
  targetDb: number;
  db: number;
}

export const createTrack = (): MeterTrack => ({
  targetDb: METER_FLOOR_DB,
  db: METER_FLOOR_DB,
});

/**
 * Advances one track by `elapsed` seconds. Pure, so the ballistics are testable without a clock.
 *
 * A target above the current level is taken whole: the backend already reports the loudest sample
 * since the last read, and easing into it would report a peak quieter than the one that happened.
 */
export const stepTrack = (track: MeterTrack, elapsed: number): MeterTrack => {
  if (track.targetDb >= track.db) {
    return { ...track, db: track.targetDb };
  }

  const step = Math.max(0, Math.min(MAX_FRAME_SECONDS, elapsed));

  return { ...track, db: Math.max(track.targetDb, track.db - FALL_DB_PER_SECOND * step) };
};

export const isTrackAtRest = (track: MeterTrack): boolean =>
  track.targetDb <= METER_FLOOR_DB && track.db <= METER_FLOOR_DB;

const tracks = new Map<SessionId, MeterTrack>();
const listeners = new Map<SessionId, Set<MeterListener>>();

let frameHandle: number | null = null;
let lastFrameAt = 0;

const trackFor = (sessionId: SessionId): MeterTrack => {
  const existing = tracks.get(sessionId);

  if (existing) {
    return existing;
  }

  const created = createTrack();
  tracks.set(sessionId, created);

  return created;
};

const publishFrame = (sessionId: SessionId, track: MeterTrack): void => {
  const subscribed = listeners.get(sessionId);

  if (!subscribed) {
    return;
  }

  for (const listener of subscribed) {
    listener(track.db);
  }
};

/**
 * Stops when every meter has settled at the floor rather than spinning on silence.
 *
 * An open panel over a quiet system is the common case, and a loop that keeps waking for it turns
 * the background CPU budget into an aspiration.
 */
const runFrame = (now: number): void => {
  const elapsed = (now - lastFrameAt) / 1000;
  lastFrameAt = now;

  let isEverythingAtRest = true;

  for (const [sessionId, track] of tracks) {
    const stepped = stepTrack(track, elapsed);
    tracks.set(sessionId, stepped);
    publishFrame(sessionId, stepped);

    if (!isTrackAtRest(stepped)) {
      isEverythingAtRest = false;
    }
  }

  if (isEverythingAtRest || listeners.size === 0) {
    frameHandle = null;
    return;
  }

  frameHandle = requestAnimationFrame(runFrame);
};

const wake = (): void => {
  if (frameHandle !== null || typeof requestAnimationFrame !== 'function') {
    return;
  }

  lastFrameAt = performance.now();
  frameHandle = requestAnimationFrame(runFrame);
};

/** Hands one backend batch to the loop. Sessions absent from the batch have gone away. */
export const publishPeaks = (peaks: SessionPeak[]): void => {
  const seen = new Set<SessionId>();

  for (const peak of peaks) {
    seen.add(peak.sessionId);
    trackFor(peak.sessionId).targetDb = amplitudeToDb(peak.peak);
  }

  for (const sessionId of tracks.keys()) {
    if (!seen.has(sessionId)) {
      tracks.delete(sessionId);
    }
  }

  wake();
};

export const subscribeToMeter = (sessionId: SessionId, listener: MeterListener): (() => void) => {
  const subscribed = listeners.get(sessionId) ?? new Set<MeterListener>();
  subscribed.add(listener);
  listeners.set(sessionId, subscribed);

  listener(trackFor(sessionId).db);
  wake();

  return () => {
    subscribed.delete(listener);

    if (subscribed.size === 0) {
      listeners.delete(sessionId);
    }
  };
};

/** Test seam. Production never needs it: the loop parks itself once everything is at the floor. */
export const resetMeterEngine = (): void => {
  if (frameHandle !== null) {
    cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }

  tracks.clear();
  listeners.clear();
};
