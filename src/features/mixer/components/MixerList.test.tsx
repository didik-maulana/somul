import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MixerList } from '@/features/mixer/components/MixerList';
import type { AudioSession, DeviceId, PlatformCapabilities, SessionId } from '@/types/ipc';

const fullPerApp: PlatformCapabilities = {
  hasPerAppVolume: true,
  hasPerAppMute: true,
  hasPerAppMeter: true,
  needsAudioPermission: false,
  hasExhaustedCaptureRetries: false,
  hasPerAppRouting: false,
  unsupportedReason: null,
};

const masterOnly: PlatformCapabilities = {
  hasPerAppVolume: false,
  hasPerAppMute: false,
  hasPerAppMeter: false,
  needsAudioPermission: false,
  hasExhaustedCaptureRetries: false,
  hasPerAppRouting: false,
  unsupportedReason: 'macOS exposes master volume only in v1.',
};

const session = (sessionId: string, displayName: string): AudioSession => ({
  sessionId: sessionId as SessionId,
  pid: 4821,
  displayName,
  processName: `${displayName.toLowerCase()}.exe`,
  iconDataUri: null,
  volume: 0.5,
  isMuted: false,
  outputDeviceId: 'mock:speakers' as DeviceId,
  state: 'active',
});

const renderList = (overrides: Partial<Parameters<typeof MixerList>[0]> = {}) =>
  render(
    <MixerList
      capabilities={fullPerApp}
      sessions={[session('mock:s:1', 'Spotify')]}
      draggingSessionIds={new Set<SessionId>()}
      onVolumeChange={vi.fn()}
      onVolumeCommit={vi.fn()}
      onMuteToggle={vi.fn()}
      onRefresh={vi.fn()}
      audioPermission={{ phase: 'unrequested', openSettings: vi.fn(), relaunch: vi.fn() }}
      {...overrides}
    />,
  );

describe('MixerList', () => {
  it('renders a row per session on a capable platform', () => {
    renderList({
      sessions: [session('mock:s:1', 'Spotify'), session('mock:s:2', 'Chrome')],
    });

    expect(screen.getAllByTestId('app-audio-row')).toHaveLength(2);
  });

  it('holds a neutral surface until capabilities arrive', () => {
    renderList({ capabilities: null });

    expect(screen.getByTestId('mixer-loading')).toBeInTheDocument();
    expect(screen.queryAllByTestId('app-audio-row')).toHaveLength(0);
  });

  /**
   * A platform without per-app volume must show the notice, never a row of dead sliders.
   */
  it('renders the notice and ZERO session rows when per-app volume is absent', () => {
    renderList({
      capabilities: masterOnly,
      sessions: [session('mock:s:1', 'Spotify'), session('mock:s:2', 'Chrome')],
    });

    expect(screen.getByText('macOS exposes master volume only in v1.')).toBeInTheDocument();
    expect(screen.queryAllByTestId('app-audio-row')).toHaveLength(0);
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
  });

  /** The branch is on reported capabilities, not on an OS sniff. */
  it('gates on capabilities rather than the user agent', () => {
    const userAgent = vi.spyOn(globalThis.navigator, 'userAgent', 'get');

    renderList({ capabilities: masterOnly });

    expect(userAgent).not.toHaveBeenCalled();
  });

  it('offers an empty state with refresh when the platform is capable but silent', () => {
    const onRefresh = vi.fn();

    renderList({ sessions: [], onRefresh });

    expect(screen.getByText('No audio playing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
  });

  it('omits the meter when the platform has no per-app metering', () => {
    renderList({ capabilities: { ...fullPerApp, hasPerAppMeter: false } });

    expect(screen.getAllByTestId('app-audio-row')).toHaveLength(1);
    expect(screen.queryByTestId('peak-meter')).not.toBeInTheDocument();
  });

  /** The scroll region contains its own overscroll, so it never scroll-chains to the panel. */
  it('contains overscroll in the scroll region', () => {
    renderList();

    expect(screen.getByTestId('mixer-scroll')).toHaveClass('overscroll-contain');
  });

  it('marks the dragging row', () => {
    renderList({ draggingSessionIds: new Set(['mock:s:1' as SessionId]) });

    expect(screen.getByTestId('app-audio-row')).toHaveAttribute('data-dragging', 'true');
  });

  /**
   * Rows would all be uncontrollable until the permission lands, and the list would also be
   * wrong: without capture there is no way to tell an app that is playing from one that merely
   * holds an output stream open.
   */
  describe('while audio capture is not granted', () => {
    const awaitingPermission: PlatformCapabilities = {
      ...fullPerApp,
      needsAudioPermission: true,
      unsupportedReason: 'Somul has not heard any app audio yet.',
    };

    it('offers the permission instead of the session list', () => {
      renderList({ capabilities: awaitingPermission });

      expect(screen.getByText('Allow Somul to hear your apps')).toBeInTheDocument();
      expect(screen.queryByTestId('app-audio-row')).not.toBeInTheDocument();
    });

    it('renders the backend reason verbatim', () => {
      renderList({ capabilities: awaitingPermission });

      expect(screen.getByText('Somul has not heard any app audio yet.')).toBeInTheDocument();
    });

    /** A notice with no way to act on it reads as a dead end, and a dead end reads as a bug. */
    it('opens the settings pane on request', async () => {
      const user = userEvent.setup();
      const openSettings = vi.fn();

      renderList({
        capabilities: awaitingPermission,
        audioPermission: { phase: 'unrequested', openSettings, relaunch: vi.fn() },
      });
      await user.click(screen.getByRole('button', { name: /open privacy settings/i }));

      expect(openSettings).toHaveBeenCalledOnce();
    });

    it('says the grant is still being waited on once settings have been opened', () => {
      renderList({
        capabilities: awaitingPermission,
        audioPermission: { phase: 'awaiting', openSettings: vi.fn(), relaunch: vi.fn() },
      });

      expect(screen.getByText('Waiting for macOS')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /relaunch somul/i })).not.toBeInTheDocument();
    });

    /**
     * The whole point of the phase. Retrying is all a running process can do, and once that is
     * spent the panel has to stop showing the button the user has already pressed.
     */
    it('offers a relaunch once retrying has stopped helping', async () => {
      const user = userEvent.setup();
      const relaunch = vi.fn();

      renderList({
        capabilities: { ...awaitingPermission, hasExhaustedCaptureRetries: true },
        audioPermission: { phase: 'relaunchRequired', openSettings: vi.fn(), relaunch },
      });
      await user.click(screen.getByRole('button', { name: /relaunch somul/i }));

      expect(relaunch).toHaveBeenCalledOnce();
    });

    /** For the user the relaunch offer guesses wrong about: they never ticked the box. */
    it('keeps a way back to the settings pane alongside the relaunch', async () => {
      const user = userEvent.setup();
      const openSettings = vi.fn();

      renderList({
        capabilities: { ...awaitingPermission, hasExhaustedCaptureRetries: true },
        audioPermission: { phase: 'relaunchRequired', openSettings, relaunch: vi.fn() },
      });
      await user.click(screen.getByRole('button', { name: /open privacy settings/i }));

      expect(openSettings).toHaveBeenCalledOnce();
    });
  });
});
