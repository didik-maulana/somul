import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppAudioRow } from '@/features/mixer/components/AppAudioRow';
import type { AudioSession, DeviceId, SessionId } from '@/types/ipc';

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

describe('AppAudioRow routing', () => {
  it('shows no picker where the platform cannot route', () => {
    renderRow();

    expect(screen.queryByTestId('session-device-selector')).toBeNull();
  });

  it('shows one once devices and a handler arrive', () => {
    renderRow({
      devices: [
        {
          deviceId: 'mock:speakers' as DeviceId,
          name: 'MacBook Pro Speakers',
          isDefault: true,
          isAvailable: true,
        },
      ],
      onDeviceSelect: vi.fn(),
    });

    expect(screen.getByTestId('session-device-selector')).toBeInTheDocument();
  });
});

describe('AppAudioRow peak meter', () => {
  it('stays out of the row until the platform reports a meter', () => {
    renderRow();

    expect(screen.queryByTestId('peak-meter')).toBeNull();
  });

  it('renders once the platform reports one', () => {
    renderRow({ hasMeter: true });

    expect(screen.getByTestId('peak-meter')).toBeInTheDocument();
  });

  it.each(['inactive', 'expired'] as const)(
    'hides the meter on a %s row, which produces no peaks to draw',
    (state) => {
      renderRow({ hasMeter: true, session: session({ state }) });

      expect(screen.queryByTestId('peak-meter')).toBeNull();
    },
  );
});

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

  /// Height follows the content now that a row can carry a meter and a device picker. What still
  /// has to hold is that two rows given the same controls come out identical, or the list stops
  /// scanning as a column -- so this pins the uniformity rather than a pixel value that had to be
  /// re-measured every time the row gained a line.
  it('gives two rows with the same controls the same shape', () => {
    const { row } = renderRow();
    const first = row.className;

    cleanup();

    const { row: second } = renderRow();

    expect(second.className).toBe(first);
  });

  it('sizes itself from its content rather than a fixed height', () => {
    const { row } = renderRow();

    expect(row.className).not.toMatch(/\bh-\[?\d/);
    expect(row).toHaveClass('py-2.5');
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
   * The logo identifies the app and the glyph mutes it. Exactly one of them is a control, so the
   * row never offers two targets for one action.
   */
  it('exposes exactly one mute control, and the logo is not it', () => {
    renderRow();

    const controls = screen.getAllByRole('button');

    expect(controls).toHaveLength(1);
    expect(controls[0]).toBe(screen.getByTestId('mute-toggle'));
    expect(controls[0]).toHaveAccessibleName('Mute Spotify');
  });

  /** The name reads on its own line, so a long one never squeezes the slider beside it. */
  it('stacks the name above the slider row', () => {
    renderRow();

    const name = screen.getByTitle('Spotify');
    const sliderRow = screen.getByRole('slider').closest('div');

    expect(name.parentElement).not.toBe(sliderRow);
    expect(name.parentElement?.parentElement).toBe(sliderRow?.parentElement);
  });

  describe('the six row states', () => {
    /** A card at rest, so four lines of one app do not run into four lines of the next. */
    it('1. default — a bordered card, quieter than the master', () => {
      const { row } = renderRow();

      expect(row).toHaveClass('bg-card', 'border-border', 'backdrop-blur-md');
      expect(row).toHaveAttribute('data-state', 'active');
    });

    /** Hover borrows the master card's surface, so the two read as one family of control. */
    it('2. hover — lifts onto the master card surface', () => {
      const { row } = renderRow();

      // The surface is already the master's at rest, so hover adds only the elevation the row
      // gives up to rank below it.
      expect(row).toHaveClass('hover:border-ring/35', 'hover:card-raised', 'hover:shadow-xs');
    });

    /**
     * Focus is shown on the control that has it, never on the row around it. A row-level ring
     * stayed lit for the whole of a slider drag, which reads as an error state on the row.
     */
    it('3. focus — the ring belongs to the control, not the row', () => {
      const { row } = renderRow();

      expect(row.className).not.toMatch(/focus-within:ring/);
      expect(screen.getByRole('slider').className).toMatch(/focus-visible:ring/);
      expect(screen.getByTestId('mute-toggle').className).toMatch(/focus-visible:ring/);
    });

    it('4. muted — name dimmed and the MUTED chip shown', () => {
      renderRow({ session: session({ isMuted: true }) });

      expect(screen.getByText('MUTED')).toBeInTheDocument();
      expect(screen.getByText('Spotify')).toHaveClass('text-muted-foreground');
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
