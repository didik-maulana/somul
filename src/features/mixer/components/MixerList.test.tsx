import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MixerList } from '@/features/mixer/components/MixerList';
import type { AudioSession, DeviceId, PlatformCapabilities, SessionId } from '@/types/ipc';

const fullPerApp: PlatformCapabilities = {
  hasPerAppVolume: true,
  hasPerAppMute: true,
  hasPerAppMeter: true,
  hasPerAppRouting: false,
  unsupportedReason: null,
};

const masterOnly: PlatformCapabilities = {
  hasPerAppVolume: false,
  hasPerAppMute: false,
  hasPerAppMeter: false,
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
      onOpenAudioPermission={vi.fn()}
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

  /**
   * The permission cannot be detected without accusing users who already granted it, so the empty
   * panel offers the door rather than a diagnosis — at the moment someone notices the list is
   * emptier than it should be.
   */
  it('offers a way to the audio permission from the empty panel', async () => {
    const onOpenAudioPermission = vi.fn();
    const user = userEvent.setup();

    renderList({ sessions: [], onOpenAudioPermission });

    await user.click(screen.getByRole('button', { name: /check permission/i }));

    expect(onOpenAudioPermission).toHaveBeenCalledOnce();
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
});
