import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppIcon } from '@/features/mixer/components/AppIcon';
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

describe('AppIcon', () => {
  it('renders the OS icon when one is supplied', () => {
    render(<AppIcon session={session({ iconDataUri: 'data:image/png;base64,iVBORw0KGgo=' })} />);

    expect(screen.getByTestId('app-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('app-icon-fallback')).not.toBeInTheDocument();
  });

  it('falls back to the initial tile when the OS supplies no icon', () => {
    render(<AppIcon session={session()} />);

    expect(screen.getByTestId('app-icon-fallback')).toHaveTextContent('S');
  });

  /**
   * The failure a null check cannot see: the backend reports a URI, and it does not decode. Left
   * unhandled it leaves a torn-image glyph where the app logo belongs.
   */
  it('falls back when a supplied icon fails to decode', () => {
    render(<AppIcon session={session({ iconDataUri: 'data:image/png;base64,not-an-image' })} />);

    fireEvent.error(screen.getByTestId('app-icon'));

    expect(screen.queryByTestId('app-icon')).not.toBeInTheDocument();
    expect(screen.getByTestId('app-icon-fallback')).toHaveTextContent('S');
  });

  it('names the tile from the process when the display name is empty', () => {
    render(<AppIcon session={session({ displayName: '   ', processName: 'discord.exe' })} />);

    expect(screen.getByTestId('app-icon-fallback')).toHaveTextContent('D');
  });

  it('never renders an empty tile when neither name is usable', () => {
    render(<AppIcon session={session({ displayName: '', processName: '' })} />);

    expect(screen.getByTestId('app-icon-fallback')).toHaveTextContent('?');
  });

  /**
   * The gradient is a 20% surface *behind* the initial. Fading the tile itself would take the
   * letter down with it and drop it below the contrast floor.
   */
  it('keeps the initial at full strength over the 20% gradient', () => {
    render(<AppIcon session={session()} />);

    const tile = screen.getByTestId('app-icon-fallback');

    expect(tile).not.toHaveClass('opacity-20');
    expect(tile.querySelector('.bg-signature')).toHaveClass('opacity-20');
    expect(screen.getByText('S')).not.toHaveClass('opacity-20');
  });

  it('is hidden from assistive technology — the row name is the accessible channel', () => {
    render(<AppIcon session={session()} />);

    expect(screen.getByTestId('app-icon-fallback')).toHaveAttribute('aria-hidden', 'true');
  });
});
