import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HotkeyRecorder } from '@/features/settings/components/HotkeyRecorder';

const { setHotkeyCaptureSpy } = vi.hoisted(() => ({
  setHotkeyCaptureSpy: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/ipc', () => ({ setHotkeyCapture: setHotkeyCaptureSpy }));

const startRecording = async (onHotkeyChange = vi.fn()) => {
  const user = userEvent.setup();

  render(<HotkeyRecorder hotkey="CmdOrCtrl+Shift+V" onHotkeyChange={onHotkeyChange} />);
  await user.click(screen.getByRole('button', { name: 'Change the panel shortcut' }));

  return { user, onHotkeyChange };
};

describe('HotkeyRecorder', () => {
  /**
   * The OS holds the current shortcut. Left registered, pressing it toggles the panel instead of
   * being recorded — you could never rebind a shortcut by pressing it.
   */
  it('frees the global shortcut while recording and restores it after', async () => {
    setHotkeyCaptureSpy.mockClear();

    const { user } = await startRecording();
    expect(setHotkeyCaptureSpy).toHaveBeenCalledWith(true);

    await user.keyboard('{Meta>}{Shift>}m{/Shift}{/Meta}');

    expect(setHotkeyCaptureSpy).toHaveBeenLastCalledWith(false);
  });

  it('restores the global shortcut when recording is cancelled', async () => {
    setHotkeyCaptureSpy.mockClear();

    const { user } = await startRecording();
    await user.keyboard('{Escape}');

    expect(setHotkeyCaptureSpy).toHaveBeenLastCalledWith(false);
  });

  it('shows the current shortcut until recording starts', () => {
    render(<HotkeyRecorder hotkey="CmdOrCtrl+Shift+V" onHotkeyChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Change the panel shortcut' })).toHaveTextContent(
      /(⌘|Ctrl) \+ Shift \+ V/,
    );
  });

  it('prompts once recording', async () => {
    await startRecording();

    expect(
      screen.getByRole('button', { name: 'Press the new shortcut, or Escape to cancel' }),
    ).toHaveTextContent('Press keys…');
  });

  it('records a modifier chord as a portable accelerator', async () => {
    const { user, onHotkeyChange } = await startRecording();

    await user.keyboard('{Meta>}{Shift>}m{/Shift}{/Meta}');

    expect(onHotkeyChange).toHaveBeenCalledWith('CmdOrCtrl+Shift+M');
  });

  /** Mid-chord the user has pressed Cmd and not yet chosen a key — recording that is wrong. */
  it('ignores modifiers held on their own', async () => {
    const { user, onHotkeyChange } = await startRecording();

    await user.keyboard('{Meta>}{/Meta}');

    expect(onHotkeyChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Press the new shortcut, or Escape to cancel' }),
    ).toHaveTextContent('Press keys…');
  });

  /** A bare letter would fire while typing anywhere in the OS. */
  it('refuses an unmodified letter', async () => {
    const { user, onHotkeyChange } = await startRecording();

    await user.keyboard('m');

    expect(onHotkeyChange).not.toHaveBeenCalled();
  });

  it('accepts a bare function key, which is not typed into anything', async () => {
    const { user, onHotkeyChange } = await startRecording();

    await user.keyboard('{F9}');

    expect(onHotkeyChange).toHaveBeenCalledWith('F9');
  });

  /** Without this, Escape is captured as a shortcut and there is no way out. */
  it('cancels on Escape instead of recording it', async () => {
    const { user, onHotkeyChange } = await startRecording();

    await user.keyboard('{Escape}');

    expect(onHotkeyChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Change the panel shortcut' })).toHaveTextContent(
      /(⌘|Ctrl) \+ Shift \+ V/,
    );
  });

  /** The surrounding row uses this to tell the user Escape is the way out. */
  it('reports when it starts and stops recording', async () => {
    const onRecordingChange = vi.fn();
    const user = userEvent.setup();

    render(
      <HotkeyRecorder
        hotkey="CmdOrCtrl+Shift+V"
        onHotkeyChange={vi.fn()}
        onRecordingChange={onRecordingChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change the panel shortcut' }));
    expect(onRecordingChange).toHaveBeenLastCalledWith(true);

    await user.keyboard('{Escape}');
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
  });

  it('renders a single control, with no separate cancel button', async () => {
    await startRecording();

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('does not record while idle', async () => {
    const onHotkeyChange = vi.fn();
    const user = userEvent.setup();

    render(<HotkeyRecorder hotkey="CmdOrCtrl+Shift+V" onHotkeyChange={onHotkeyChange} />);
    screen.getByRole('button', { name: 'Change the panel shortcut' }).focus();
    await user.keyboard('{Meta>}{Shift>}m{/Shift}{/Meta}');

    expect(onHotkeyChange).not.toHaveBeenCalled();
  });
});
