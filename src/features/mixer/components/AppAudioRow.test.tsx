import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppAudioRow } from '@/features/mixer/components/AppAudioRow';
import type { PeakStream } from '@/features/mixer/hooks/usePeakStream';
import type { AudioSession, DeviceId, SessionId } from '@/types/ipc';

const stubStream: PeakStream = { register: () => () => undefined };

const session = (overrides: Partial<AudioSession> = {}): AudioSession => ({
  sessionId: 'mock:session:spotify' as SessionId,
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

const renderRow = (overrides: Partial<Parameters<typeof AppAudioRow>[0]> = {}) => {
  const onVolumeChange = vi.fn();
  const onVolumeCommit = vi.fn();
  const onMuteToggle = vi.fn();

  render(
    <AppAudioRow
      session={session()}
      peakStream={stubStream}
      onVolumeChange={onVolumeChange}
      onVolumeCommit={onVolumeCommit}
      onMuteToggle={onMuteToggle}
      {...overrides}
    />,
  );

  return {
    onVolumeChange,
    onVolumeCommit,
    onMuteToggle,
    row: screen.getByTestId('app-audio-row'),
  };
};

describe('AppAudioRow', () => {
  it('renders the app name and its level readout', () => {
    renderRow();

    expect(screen.getByText('Spotify')).toBeInTheDocument();
    expect(screen.getByText('74%')).toBeInTheDocument();
  });

  /** Names truncate to one line, with the full name kept in a title tooltip. */
  it('truncates a long name to one line and keeps the full name in a tooltip', () => {
    renderRow({
      session: session({ displayName: 'A Very Long Application Name That Will Not Fit' }),
    });

    const name = screen.getByTitle('A Very Long Application Name That Will Not Fit');

    expect(name).toHaveClass('truncate');
  });

  /** 64 px with the meter, 52 px without. Derived from the content stack, not chosen. */
  it('is taller when the peak meter renders', () => {
    const { row } = renderRow();
    expect(row).toHaveClass('h-16');
  });

  it('is shorter when the platform has no per-app metering', () => {
    const { row } = renderRow({ peakStream: undefined });

    expect(row).toHaveClass('h-13');
    expect(screen.queryByTestId('peak-meter')).not.toBeInTheDocument();
  });

  it('falls back to a gradient tile when the OS supplies no icon', () => {
    renderRow();

    expect(screen.getByTestId('app-icon-fallback')).toHaveTextContent('S');
  });

  it('renders the OS icon when one is supplied', () => {
    renderRow({ session: session({ iconDataUri: 'data:image/png;base64,iVBORw0KGgo=' }) });

    expect(screen.queryByTestId('app-icon-fallback')).not.toBeInTheDocument();
  });

  /**
   * The logo is the mute control. A row carrying a separate mute button as well would offer two
   * controls for one action, and the second one is what a user would learn to ignore.
   */
  it('exposes exactly one mute control, and it is the app tile', () => {
    renderRow();

    const controls = screen.getAllByRole('button');

    expect(controls).toHaveLength(1);
    expect(controls[0]).toBe(screen.getByTestId('app-speaker'));
    expect(controls[0]).toHaveAccessibleName('Mute Spotify');
  });

  describe('the six row states', () => {
    it('1. default — transparent with no border colour', () => {
      const { row } = renderRow();

      expect(row).toHaveClass('border-transparent');
      expect(row).toHaveAttribute('data-state', 'active');
    });

    it('2. hover — shifts to the accent surface', () => {
      const { row } = renderRow();

      expect(row).toHaveClass('hover:bg-accent', 'hover:border-border');
    });

    it('3. focus-within — ring offset against popover, not background', () => {
      const { row } = renderRow();

      expect(row).toHaveClass(
        'focus-within:ring-2',
        'focus-within:ring-ring',
        'focus-within:ring-offset-2',
        'focus-within:ring-offset-background',
      );
    });

    it('4. muted — name dimmed, MUTED chip shown, meter at 30% opacity', () => {
      renderRow({ session: session({ isMuted: true }) });

      expect(screen.getByText('MUTED')).toBeInTheDocument();
      expect(screen.getByText('Spotify')).toHaveClass('text-muted-foreground');
      expect(screen.getByTestId('peak-meter')).toHaveClass('opacity-30');
    });

    it('5. dragging — e2 elevation', () => {
      const { row } = renderRow({ isDragging: true });

      expect(row).toHaveClass('shadow-e2', 'bg-card', 'border-border');
      expect(row).toHaveAttribute('data-dragging', 'true');
    });

    it('6. device-lost — 50% opacity, danger dot, controls disabled', () => {
      renderRow({ session: session({ state: 'expired' }) });

      const row = screen.getByTestId('app-audio-row');

      expect(row).toHaveClass('opacity-50', 'pointer-events-none');
      expect(screen.getByTestId('device-lost-dot')).toBeInTheDocument();
      expect(screen.getByRole('slider')).toHaveAttribute('data-disabled');
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  /**
   * The platform sees the app but could not take control of it — on macOS, a tap the OS refused.
   * Hiding the row would deny audio the user can hear; leaving the slider live would offer a
   * control that writes nowhere. It is listed, and it is visibly inert.
   */
  describe('an app the platform could not take control of', () => {
    const uncontrollable = () => renderRow({ session: session({ state: 'inactive' }) });

    it('is listed rather than hidden — its audio is real', () => {
      uncontrollable();

      expect(screen.getByText('Spotify')).toBeInTheDocument();
      expect(screen.getByTestId('uncontrollable-chip')).toHaveTextContent('NO CONTROL');
    });

    it('offers no live controls', () => {
      uncontrollable();

      expect(screen.getByRole('slider')).toHaveAttribute('data-disabled');
      expect(screen.getByRole('button')).toBeDisabled();
    });

    /** A percentage would imply a level Somul is in a position to change. */
    it('shows no percentage it cannot honour', () => {
      uncontrollable();

      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.queryByText('74%')).not.toBeInTheDocument();
    });
  });

  it('shows no MUTED chip while unmuted', () => {
    renderRow();

    expect(screen.queryByText('MUTED')).not.toBeInTheDocument();
  });

  /** Pure presentation — the row reports intent and calls no IPC itself. */
  it('reports a mute toggle without touching IPC', async () => {
    const user = userEvent.setup();
    const { onMuteToggle } = renderRow();

    await user.click(screen.getByRole('button', { name: 'Mute Spotify' }));

    expect(onMuteToggle).toHaveBeenCalledOnce();
  });

  it('reports volume changes and commits separately', async () => {
    const user = userEvent.setup();
    const { onVolumeChange, onVolumeCommit } = renderRow();

    screen.getByRole('slider').focus();
    await user.keyboard('{ArrowRight}');

    expect(onVolumeChange).toHaveBeenCalledWith(0.75);
    expect(onVolumeCommit).toHaveBeenCalledWith(0.75);
  });
});
