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
  muteMemory: {},
};

const { setMasterVolumeSpy, checkForUpdateSpy } = vi.hoisted(() => ({
  setMasterVolumeSpy: vi.fn(() => Promise.resolve()),
  checkForUpdateSpy: vi.fn(
    (): Promise<{
      phase: string;
      currentVersion: string;
      availableVersion: string | null;
      notes: string | null;
    }> =>
      Promise.resolve({
        phase: 'upToDate',
        currentVersion: '1.0.0',
        availableVersion: null,
        notes: null,
      }),
  ),
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
  getUpdateState: () =>
    Promise.resolve({
      phase: 'idle',
      currentVersion: '1.0.0',
      availableVersion: null,
      notes: null,
    }),
  checkForUpdate: checkForUpdateSpy,
  installUpdate: () => Promise.resolve(),
  openUpdateWindow: () => Promise.resolve(),
  onUpdateChanged: () => Promise.resolve(() => undefined),
  onUpdateProgress: () => Promise.resolve(() => undefined),
  onPanelShown: () => Promise.resolve(() => undefined),
  openAudioPermissionSettings: () => Promise.resolve(),
  relaunchApp: () => Promise.resolve(),
  onCapabilitiesChanged: () => Promise.resolve(() => undefined),
  onSessionsChanged: () => Promise.resolve(() => undefined),
  onMasterChanged: () => Promise.resolve(() => undefined),
  onMasterResync: () => Promise.resolve(() => undefined),
  onDeviceChanged: () => Promise.resolve(() => undefined),
  toAudioError: (thrown: unknown) => ({ kind: 'backendFailure', detail: String(thrown) }),
}));

beforeEach(() => {
  setMasterVolumeSpy.mockClear();
  checkForUpdateSpy.mockClear().mockResolvedValue({
    phase: 'upToDate',
    currentVersion: '1.0.0',
    availableVersion: null,
    notes: null,
  });
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

  /** The footer used to carry a hardcoded version, which the first self-update made a lie. */
  it('names the running build in the footer', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    });
  });

  /** Nobody opens settings to discover they are on an old build, so the panel says so itself. */
  it('raises an update notice above the mixer when a newer version exists', async () => {
    checkForUpdateSpy.mockResolvedValue({
      phase: 'available',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      notes: null,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('update-notice')).toHaveTextContent('Update available');
    });

    expect(screen.getByTestId('update-notice')).toHaveTextContent('1.1.0');
  });

  it('keeps the notice off the panel while the build is current', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('master-volume-card')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('update-notice')).not.toBeInTheDocument();
  });

  /** Settings carries the same news in its own row — two copies on one screen reads as a bug. */
  it('drops the notice while settings is open', async () => {
    checkForUpdateSpy.mockResolvedValue({
      phase: 'available',
      currentVersion: '1.0.0',
      availableVersion: '1.1.0',
      notes: null,
    });

    await openSettings();

    expect(screen.queryByTestId('update-notice')).not.toBeInTheDocument();
    expect(screen.getByText('Version 1.1.0 is ready to install')).toBeInTheDocument();
  });
});
