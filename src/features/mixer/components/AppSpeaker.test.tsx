import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSpeaker } from '@/features/mixer/components/AppSpeaker';
import { usePeakStream, type PeakStream } from '@/features/mixer/hooks/usePeakStream';
import type { AudioSession, DeviceId, SessionId, SessionPeak } from '@/types/ipc';

const listeners: ((peaks: SessionPeak[]) => void)[] = [];

vi.mock('@/lib/ipc', () => ({
  onPeaks: (onEvent: (peaks: SessionPeak[]) => void) => {
    listeners.push(onEvent);
    return Promise.resolve(() => undefined);
  },
}));

const sessionId = 'mock:session:spotify' as SessionId;

const session = (overrides: Partial<AudioSession> = {}): AudioSession => ({
  sessionId,
  pid: 4821,
  displayName: 'Spotify',
  processName: 'spotify.exe',
  iconDataUri: null,
  volume: 0.74,
  isMuted: false,
  outputDeviceId: 'mock:speakers' as DeviceId,
  state: 'active',
  ...overrides,
});

const stubStream: PeakStream = { register: () => () => undefined };

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

const LiveSpeaker = ({ audioSession }: { audioSession: AudioSession }) => {
  const stream = usePeakStream();

  return <AppSpeaker session={audioSession} peakStream={stream} onMuteToggle={() => undefined} />;
};

describe('AppSpeaker', () => {
  it('names the app in the control, not the bare action', async () => {
    const user = userEvent.setup();
    const onMuteToggle = vi.fn();

    render(
      <AppSpeaker session={session()} peakStream={stubStream} onMuteToggle={onMuteToggle} />,
    );

    await user.click(screen.getByRole('button', { name: 'Mute Spotify' }));

    expect(onMuteToggle).toHaveBeenCalledOnce();
  });

  it('offers to unmute once muted, and reports the state to assistive technology', () => {
    render(
      <AppSpeaker
        session={session({ isMuted: true })}
        peakStream={stubStream}
        onMuteToggle={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Unmute Spotify' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  /** Mute must read at rest. A hover-only glyph would leave a muted app looking like a live one. */
  it('shows the muted glyph without hover', () => {
    render(
      <AppSpeaker
        session={session({ isMuted: true })}
        peakStream={stubStream}
        onMuteToggle={() => undefined}
      />,
    );

    expect(screen.getByTestId('app-speaker-glyph')).toHaveClass('opacity-100');
  });

  it('keeps the glyph off an unmuted tile until hover or keyboard focus', () => {
    render(
      <AppSpeaker session={session()} peakStream={stubStream} onMuteToggle={() => undefined} />,
    );

    const glyph = screen.getByTestId('app-speaker-glyph');

    expect(glyph).toHaveClass('opacity-0');
    expect(glyph).toHaveClass('group-hover/speaker:opacity-100');
    expect(glyph).toHaveClass('group-focus-visible/speaker:opacity-100');
  });

  it('is disabled when the session has expired', () => {
    render(
      <AppSpeaker
        session={session({ state: 'expired' })}
        peakStream={stubStream}
        isDisabled
        onMuteToggle={() => undefined}
      />,
    );

    expect(screen.getByTestId('app-speaker')).toBeDisabled();
  });

  describe('the live ring', () => {
    it('publishes the level as a custom property rather than a transform', () => {
      render(<LiveSpeaker audioSession={session()} />);

      emitPeaks([{ sessionId, peak: 0.5 }]);
      advanceOneFrame();

      const ring = screen.getByTestId('speaker-ring');

      expect(ring.style.getPropertyValue('--peak-level')).toBe('0.500');
      // The scale mapping is the stylesheet's, so the reduced-motion variant is a CSS concern.
      expect(ring.style.transform).toBe('');
    });

    it('reports the band as a data attribute so the theme swap needs no JavaScript', () => {
      render(<LiveSpeaker audioSession={session()} />);

      emitPeaks([{ sessionId, peak: 1 }]);
      advanceOneFrame();

      expect(screen.getByTestId('speaker-ring')).toHaveAttribute('data-band', 'clip');
    });

    it('never renders for a muted app — there is no level to show', () => {
      render(<LiveSpeaker audioSession={session({ isMuted: true })} />);

      expect(screen.queryByTestId('speaker-ring')).not.toBeInTheDocument();
    });

    it('never renders on a platform without per-app metering', () => {
      render(<AppSpeaker session={session()} onMuteToggle={() => undefined} />);

      expect(screen.queryByTestId('speaker-ring')).not.toBeInTheDocument();
    });

    it('carries no CSS transition — a transition would smear the signal', () => {
      render(<LiveSpeaker audioSession={session()} />);

      expect(screen.getByTestId('speaker-ring').className).not.toMatch(/transition/);
    });

    it('is hidden from assistive technology', () => {
      render(<LiveSpeaker audioSession={session()} />);

      expect(screen.getByTestId('speaker-ring')).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
