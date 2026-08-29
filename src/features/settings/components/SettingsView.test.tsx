import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingsView } from '@/features/settings/components/SettingsView';

// The recorder suspends the global shortcut over IPC; without a Tauri runtime that rejects.
vi.mock('@/lib/ipc', () => ({ setHotkeyCapture: () => Promise.resolve() }));
import type { UpdateStatus } from '@/features/update/types';
import type { AppSettings } from '@/types/ipc';

const upToDate: UpdateStatus = {
  phase: 'upToDate',
  currentVersion: '1.0.0',
  availableVersion: null,
  notes: null,
  downloadFraction: null,
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

const renderView = (overrides: Partial<Parameters<typeof SettingsView>[0]> = {}) => {
  const onSettingsChange = vi.fn();
  const onOpenAudioPermission = vi.fn();
  const onUpdateCheck = vi.fn();
  const onUpdateInstall = vi.fn();
  const onUpdateRestart = vi.fn();
  const onOpenAboutLink = vi.fn();
  const onClose = vi.fn();

  render(
    <SettingsView
      settings={settings}
      hotkeyWarning={null}
      updateStatus={upToDate}
      onSettingsChange={onSettingsChange}
      onOpenAudioPermission={onOpenAudioPermission}
      onUpdateCheck={onUpdateCheck}
      onUpdateInstall={onUpdateInstall}
      onUpdateRestart={onUpdateRestart}
      onOpenAboutLink={onOpenAboutLink}
      onClose={onClose}
      {...overrides}
    />,
  );

  return {
    onSettingsChange,
    onOpenAudioPermission,
    onUpdateCheck,
    onUpdateInstall,
    onUpdateRestart,
    onOpenAboutLink,
    onClose,
    user: userEvent.setup(),
  };
};

describe('SettingsView', () => {
  it('holds a neutral surface until settings load', () => {
    renderView({ settings: null });

    expect(screen.getByTestId('settings-loading')).toBeInTheDocument();
  });

  it('shows the current shortcut in a readable form', () => {
    renderView();

    expect(screen.getByRole('button', { name: 'Change the panel shortcut' })).toHaveTextContent(
      /(⌘|Ctrl) \+ Shift \+ V/,
    );
  });

  /** Escape is the only exit, and "Press keys…" gives no hint that one key means cancel. */
  it('explains how to cancel while recording a shortcut', async () => {
    const { user } = renderView();

    expect(screen.getByText('Opens and closes the panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change the panel shortcut' }));

    expect(screen.getByText('Press Escape to cancel')).toBeInTheDocument();
    expect(screen.queryByText('Opens and closes the panel')).not.toBeInTheDocument();
  });

  it('restores the ordinary hint once recording ends', async () => {
    const { user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Change the panel shortcut' }));
    await user.keyboard('{Escape}');

    expect(screen.getByText('Opens and closes the panel')).toBeInTheDocument();
  });

  it('reports a theme choice', async () => {
    const { onSettingsChange, user } = renderView();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, theme: 'dark' });
  });

  it('marks the active theme for assistive technology', () => {
    renderView({ settings: { ...settings, theme: 'light' } });

    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false');
  });

  /** One pill that travels, not a background blinking between options. */
  it('slides a single indicator to the active theme', () => {
    const { unmount } = render(
      <SettingsView
        settings={settings}
        hotkeyWarning={null}
        updateStatus={upToDate}
        onSettingsChange={vi.fn()}
        onOpenAudioPermission={vi.fn()}
        onUpdateCheck={vi.fn()}
        onUpdateInstall={vi.fn()}
        onUpdateRestart={vi.fn()}
        onOpenAboutLink={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('theme-indicator')).toHaveStyle({ transform: 'translateX(0%)' });
    unmount();

    render(
      <SettingsView
        settings={{ ...settings, theme: 'light' }}
        hotkeyWarning={null}
        updateStatus={upToDate}
        onSettingsChange={vi.fn()}
        onOpenAudioPermission={vi.fn()}
        onUpdateCheck={vi.fn()}
        onUpdateInstall={vi.fn()}
        onUpdateRestart={vi.fn()}
        onOpenAboutLink={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('theme-indicator')).toHaveStyle({ transform: 'translateX(200%)' });
  });

  it('animates the indicator with transform, never layout', () => {
    renderView();

    const indicator = screen.getByTestId('theme-indicator');

    expect(indicator).toHaveClass('transition-transform', 'motion-reduce:transition-none');
    expect(indicator.className).not.toContain('transition-all');
  });

  it('reports launch at login', async () => {
    const { onSettingsChange, user } = renderView();

    await user.click(screen.getByRole('switch', { name: 'Launch at login' }));

    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, shouldLaunchAtLogin: true });
  });

  /** A shortcut the OS refused must say so, or the user thinks it took. */
  it('surfaces a hotkey warning as an alert', () => {
    renderView({ hotkeyWarning: 'Another application already owns that shortcut.' });

    expect(screen.getByRole('alert')).toHaveTextContent('already owns that shortcut');
  });

  it('shows no alert when nothing is wrong', () => {
    renderView();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /** Somul updates itself or not at all — nothing outside the app moves a user off a build. */
  it('offers a manual update check', async () => {
    const { onUpdateCheck, user } = renderView();

    expect(screen.getByText('Up to date')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check for updates' }));

    expect(onUpdateCheck).toHaveBeenCalledOnce();
  });

  it('turns the update row into an install once a newer version exists', async () => {
    const { onUpdateInstall, user } = renderView({
      updateStatus: {
        phase: 'available',
        currentVersion: '1.0.0',
        availableVersion: '1.1.0',
        notes: null,
        downloadFraction: null,
      },
    });

    expect(screen.getByText('Version 1.1.0 is ready to install')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check for updates' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Install update' }));

    expect(onUpdateInstall).toHaveBeenCalledOnce();
  });

  /** The build on disk is new, the one running is not — the row has to say which. */
  it('asks for a restart once the update is installed', async () => {
    const { onUpdateRestart, user } = renderView({
      updateStatus: {
        phase: 'installed',
        currentVersion: '1.0.0',
        availableVersion: '1.1.0',
        notes: null,
        downloadFraction: null,
      },
    });

    expect(
      screen.getByText('Version 1.1.0 installed — restart to use it'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restart to finish the update' }));

    expect(onUpdateRestart).toHaveBeenCalledOnce();
  });

  /**
   * The one affordance left for a withheld permission. Somul cannot detect that state without
   * accusing users who have already granted it, so the door is always here and claims nothing.
   */
  it('always offers a way to the audio permission, whatever the state', async () => {
    const { onOpenAudioPermission, user } = renderView();

    expect(
      screen.getByText("Per-app mixing needs macOS's audio-capture permission"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open Settings' }));

    expect(onOpenAudioPermission).toHaveBeenCalledOnce();
  });

  it('hands each About icon to the opener by name', async () => {
    const { onOpenAboutLink, user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Report an issue' }));

    expect(onOpenAboutLink).toHaveBeenCalledWith('issues');
  });

  it('closes back to the mixer', async () => {
    const { onClose, user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Back to mixer' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
