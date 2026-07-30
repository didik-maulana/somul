import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MuteToggle } from '@/features/mixer/components/MuteToggle';

const iconOf = (): string | null =>
  screen.getByRole('button').querySelector('svg')?.getAttribute('class') ?? null;

describe('MuteToggle', () => {
  const noop = () => undefined;

  /** The label names the app, not the bare action. */
  it('names the app it mutes', () => {
    render(<MuteToggle isMuted={false} volume={0.7} appName="Spotify" onMuteToggle={noop} />);

    expect(screen.getByRole('button', { name: 'Mute Spotify' })).toBeInTheDocument();
  });

  it('names the reverse action once muted', () => {
    render(<MuteToggle isMuted volume={0.7} appName="Spotify" onMuteToggle={noop} />);

    expect(screen.getByRole('button', { name: 'Unmute Spotify' })).toBeInTheDocument();
  });

  it('exposes its state to assistive technology', () => {
    const { rerender } = render(
      <MuteToggle isMuted={false} volume={0.7} appName="Spotify" onMuteToggle={noop} />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');

    rerender(<MuteToggle isMuted volume={0.7} appName="Spotify" onMuteToggle={noop} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  /** Volume2 above 50%, Volume1 at or below, VolumeX when muted. */
  it('shows the loud glyph above fifty percent', () => {
    render(<MuteToggle isMuted={false} volume={0.7} appName="Spotify" onMuteToggle={noop} />);

    expect(iconOf()).toContain('lucide-volume-2');
  });

  it('shows the quiet glyph at or below fifty percent', () => {
    render(<MuteToggle isMuted={false} volume={0.5} appName="Spotify" onMuteToggle={noop} />);

    expect(iconOf()).toContain('lucide-volume-1');
  });

  it('shows the muted glyph regardless of level when muted', () => {
    render(<MuteToggle isMuted volume={0.9} appName="Spotify" onMuteToggle={noop} />);

    expect(iconOf()).toContain('lucide-volume-x');
  });

  it('carries the destructive treatment when muted', () => {
    render(<MuteToggle isMuted volume={0.9} appName="Spotify" onMuteToggle={noop} />);

    expect(screen.getByRole('button')).toHaveClass('text-destructive', 'bg-destructive/10');
  });

  it('reports activation', async () => {
    const user = userEvent.setup();
    const handleMuteToggle = vi.fn();

    render(
      <MuteToggle isMuted={false} volume={0.7} appName="Spotify" onMuteToggle={handleMuteToggle} />,
    );

    await user.click(screen.getByRole('button'));

    expect(handleMuteToggle).toHaveBeenCalledOnce();
  });

  it('is inert when disabled', async () => {
    const user = userEvent.setup();
    const handleMuteToggle = vi.fn();

    render(
      <MuteToggle
        isMuted={false}
        volume={0.7}
        appName="Spotify"
        isDisabled
        onMuteToggle={handleMuteToggle}
      />,
    );

    await user.click(screen.getByRole('button'));

    expect(handleMuteToggle).not.toHaveBeenCalled();
  });
});
