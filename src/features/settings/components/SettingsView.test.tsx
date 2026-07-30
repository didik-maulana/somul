import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingsView } from '@/features/settings/components/SettingsView';

// The recorder suspends the global shortcut over IPC; without a Tauri runtime that rejects.
vi.mock('@/lib/ipc', () => ({ setHotkeyCapture: () => Promise.resolve() }));
import type { AppSettings } from '@/types/ipc';

const settings: AppSettings = {
  schemaVersion: 1,
  hotkey: 'CmdOrCtrl+Shift+V',
  theme: 'system',
  shouldLaunchAtLogin: false,
  isPanelPinned: false,
  routingPresets: {},
  volumeMemory: {},
};

const renderView = (overrides: Partial<Parameters<typeof SettingsView>[0]> = {}) => {
  const onSettingsChange = vi.fn();
  const onClose = vi.fn();

  render(
    <SettingsView
      settings={settings}
      hotkeyWarning={null}
      onSettingsChange={onSettingsChange}
      onClose={onClose}
      {...overrides}
    />,
  );

  return { onSettingsChange, onClose, user: userEvent.setup() };
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
        onSettingsChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('theme-indicator')).toHaveStyle({ transform: 'translateX(0%)' });
    unmount();

    render(
      <SettingsView
        settings={{ ...settings, theme: 'light' }}
        hotkeyWarning={null}
        onSettingsChange={vi.fn()}
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

  it('reports the pin', async () => {
    const { onSettingsChange, user } = renderView();

    await user.click(screen.getByRole('switch', { name: 'Show on all desktops' }));

    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, isPanelPinned: true });
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

  it('closes back to the mixer', async () => {
    const { onClose, user } = renderView();

    await user.click(screen.getByRole('button', { name: 'Back to mixer' }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
