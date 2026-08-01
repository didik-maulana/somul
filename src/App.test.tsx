import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '@/App';
import { useAudioStore } from '@/stores/audioStore';
import type { AppSettings, DeviceId, MasterState, SessionId } from '@/types/ipc';

const master: MasterState = {
  deviceId: 'd' as DeviceId,
  deviceName: 'MacBook Pro Speakers',
  volume: 0.44,
  isMuted: false,
  isVolumeControllable: true,
};

const settings: AppSettings = {
  schemaVersion: 1,
  hotkey: 'CmdOrCtrl+Shift+V',
  theme: 'system',
  shouldLaunchAtLogin: false,
  routingPresets: {},
  volumeMemory: {},
};

const { setMasterVolumeSpy } = vi.hoisted(() => ({
  setMasterVolumeSpy: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/ipc', () => ({
  getPlatformCapabilities: () =>
    Promise.resolve({
      hasPerAppVolume: false,
      hasPerAppMute: false,
      hasPerAppMeter: false,
      hasPerAppRouting: false,
      needsAudioPermission: false,
      unsupportedReason: 'macOS exposes master volume only.',
    }),
  getAudioSessions: () => Promise.resolve([]),
  getMasterState: () => Promise.resolve(master),
  listOutputDevices: () => Promise.resolve([]),
  getSettings: () => Promise.resolve(settings),
  updateSettings: (next: AppSettings) =>
    Promise.resolve({ settings: next, hotkeyWarning: null }),
  setMasterVolume: setMasterVolumeSpy,
  setSessionVolume: () => Promise.resolve(),
  setMasterMute: () => Promise.resolve(),
  setSessionMute: () => Promise.resolve(),
  setDefaultOutputDevice: () => Promise.resolve(),
  setHotkeyCapture: () => Promise.resolve(),
  onPanelShown: () => Promise.resolve(() => undefined),
  openAudioPermissionSettings: () => Promise.resolve(),
  onSessionsChanged: () => Promise.resolve(() => undefined),
  onMasterChanged: () => Promise.resolve(() => undefined),
  onMasterResync: () => Promise.resolve(() => undefined),
  onDeviceChanged: () => Promise.resolve(() => undefined),
  toAudioError: (thrown: unknown) => ({ kind: 'backendFailure', detail: String(thrown) }),
}));

beforeEach(() => {
  setMasterVolumeSpy.mockClear();
  useAudioStore.setState({
    sessions: [],
    devices: [],
    master: null,
    capabilities: null,
    draggingSessionIds: new Set<SessionId>(),
    isDraggingMaster: false,
  });
});

const openSettings = async () => {
  const user = userEvent.setup();

  render(<App />);
  await waitFor(() => {
    expect(screen.getByTestId('master-volume-card')).toBeInTheDocument();
  });

  await user.click(screen.getByRole('button', { name: 'Open settings' }));

  return user;
};

describe('App', () => {
  it('shows the master card on the mixer view', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('master-volume-card')).toBeInTheDocument();
    });
  });

  /** Settings takes the whole panel — a control above a settings form reads as two screens. */
  it('hides the master card while settings is open', async () => {
    await openSettings();

    expect(screen.getByTestId('settings-view')).toBeInTheDocument();
    expect(screen.queryByTestId('master-volume-card')).not.toBeInTheDocument();
  });

  it('brings the master card back on close', async () => {
    const user = await openSettings();

    await user.click(screen.getByRole('button', { name: 'Back to mixer' }));

    expect(screen.getByTestId('master-volume-card')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-view')).not.toBeInTheDocument();
  });

  it('writes nothing to the system volume just by opening settings', async () => {
    await openSettings();

    expect(setMasterVolumeSpy).not.toHaveBeenCalled();
  });
});
