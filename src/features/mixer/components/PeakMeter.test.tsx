import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PeakMeter } from '@/features/mixer/components/PeakMeter';
import { usePeakStream } from '@/features/mixer/hooks/usePeakStream';
import type { SessionId, SessionPeak } from '@/types/ipc';

const listeners: ((peaks: SessionPeak[]) => void)[] = [];
const unlisten = vi.fn();

vi.mock('@/lib/ipc', () => ({
  onPeaks: (onEvent: (peaks: SessionPeak[]) => void) => {
    listeners.push(onEvent);
    return Promise.resolve(unlisten);
  },
}));

const sessionId = 'mock:session:spotify' as SessionId;

/** Drives the rAF loop deterministically instead of waiting on wall-clock frames. */
let frameCallbacks: FrameRequestCallback[] = [];
let now = 0;

const advanceOneFrame = (elapsedMs = 1000 / 60) => {
  now += elapsedMs;
  const pending = frameCallbacks;
  frameCallbacks = [];
  act(() => {
    for (const callback of pending) {
      callback(now);
    }
  });
};

const emitPeaks = (peaks: SessionPeak[]) => {
  act(() => {
    for (const listener of listeners) {
      listener(peaks);
    }
  });
};

const Harness = ({ sessions }: { sessions: SessionId[] }) => {
  const stream = usePeakStream();

  return (
    <>
      {sessions.map((id) => (
        <PeakMeter key={id} sessionId={id} stream={stream} />
      ))}
    </>
  );
};

beforeEach(() => {
  listeners.length = 0;
  frameCallbacks = [];
  now = 0;

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const fillOf = (index = 0): HTMLElement => screen.getAllByTestId('peak-meter-fill')[index];

describe('PeakMeter', () => {
  /** The meter is decorative; the dB readout is the accessible channel. */
  it('is hidden from assistive technology', () => {
    render(<Harness sessions={[sessionId]} />);

    expect(screen.getByTestId('peak-meter')).toHaveAttribute('aria-hidden', 'true');
  });

  it('starts silent', () => {
    render(<Harness sessions={[sessionId]} />);

    expect(fillOf()).toHaveClass('scale-x-0');
  });

  /** scaleX only — a width write would trigger layout on every frame. */
  it('drives the fill with transform: scaleX', () => {
    render(<Harness sessions={[sessionId]} />);

    emitPeaks([{ sessionId, peak: 0.5 }]);
    advanceOneFrame();

    const fill = fillOf();

    expect(fill.style.transform).toBe('scaleX(0.5)');
    expect(fill.style.width).toBe('');
  });

  /** A CSS transition would smear the signal, so the fill carries none. */
  it('carries no CSS transition on the fill', () => {
    render(<Harness sessions={[sessionId]} />);

    expect(fillOf().className).not.toMatch(/transition/);
  });

  it('rises instantly and decays between frames', () => {
    render(<Harness sessions={[sessionId]} />);

    emitPeaks([{ sessionId, peak: 0.9 }]);
    advanceOneFrame();
    expect(fillOf().style.transform).toBe('scaleX(0.9)');

    emitPeaks([{ sessionId, peak: 0 }]);
    advanceOneFrame(100);

    const decayed = Number(/scaleX\(([\d.]+)\)/.exec(fillOf().style.transform)?.[1]);

    expect(decayed).toBeLessThan(0.9);
    expect(decayed).toBeGreaterThan(0);
  });

  /** Band colour is data-driven, so the light/dark swap needs no JavaScript. */
  it('reports the band as a data attribute rather than a hardcoded colour', () => {
    render(<Harness sessions={[sessionId]} />);

    emitPeaks([{ sessionId, peak: 1 }]);
    advanceOneFrame();
    expect(fillOf()).toHaveAttribute('data-band', 'clip');

    emitPeaks([{ sessionId, peak: 0.01 }]);
    advanceOneFrame(5000);
    expect(fillOf()).toHaveAttribute('data-band', 'floor');
  });
});

describe('usePeakStream', () => {
  /**
   * The failure this guards against: peaks leaking into React state. If they had, the component
   * would re-render on every frame — thirty times a second, per row.
   */
  it('never re-renders a row on a peak update', () => {
    const renderSpy = vi.fn();

    const CountingMeter = ({ stream }: { stream: ReturnType<typeof usePeakStream> }) => {
      renderSpy();
      return <PeakMeter sessionId={sessionId} stream={stream} />;
    };

    const CountingHarness = () => {
      const stream = usePeakStream();
      return <CountingMeter stream={stream} />;
    };

    render(<CountingHarness />);
    const rendersAfterMount = renderSpy.mock.calls.length;

    for (let frame = 0; frame < 30; frame += 1) {
      emitPeaks([{ sessionId, peak: frame / 30 }]);
      advanceOneFrame();
    }

    expect(renderSpy).toHaveBeenCalledTimes(rendersAfterMount);
  });

  /** One loop for the whole panel, not one timer per row. */
  it('runs a single rAF loop no matter how many rows are mounted', () => {
    const sessions = ['a:1', 'b:2', 'c:3', 'd:4'] as SessionId[];

    render(<Harness sessions={sessions} />);

    expect(screen.getAllByTestId('peak-meter')).toHaveLength(4);
    expect(frameCallbacks).toHaveLength(1);
  });

  it('paints every mounted row from the one batched event', () => {
    const sessions = ['a:1', 'b:2', 'c:3'] as SessionId[];

    render(<Harness sessions={sessions} />);

    emitPeaks(sessions.map((id, index) => ({ sessionId: id, peak: (index + 1) * 0.2 })));
    advanceOneFrame();

    expect(fillOf(0).style.transform).toBe('scaleX(0.2)');
    expect(fillOf(1).style.transform).toBe('scaleX(0.4)');
    expect(fillOf(2).style.transform).toBe('scaleX(0.6000000000000001)');
  });

  it('stops tracking a row once it unmounts', () => {
    const { rerender } = render(<Harness sessions={['a:1', 'b:2'] as SessionId[]} />);

    expect(frameCallbacks).toHaveLength(1);

    rerender(<Harness sessions={['a:1'] as SessionId[]} />);
    advanceOneFrame();

    expect(screen.getAllByTestId('peak-meter')).toHaveLength(1);
  });
});
