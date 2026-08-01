import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VolumeSlider } from '@/features/mixer/components/VolumeSlider';

const renderSlider = (props: Partial<Parameters<typeof VolumeSlider>[0]> = {}) => {
  const onVolumeChange = vi.fn();
  const onVolumeCommit = vi.fn();

  render(
    <VolumeSlider
      volume={0.74}
      label="Volume for Spotify"
      onVolumeChange={onVolumeChange}
      onVolumeCommit={onVolumeCommit}
      {...props}
    />,
  );

  return { onVolumeChange, onVolumeCommit, slider: screen.getByRole('slider') };
};

describe('VolumeSlider', () => {
  it('renders the scalar as a percentage on the underlying control', () => {
    const { slider } = renderSlider();

    expect(slider).toHaveAttribute('aria-valuenow', '74');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
  });

  /** A human string, not the raw float. */
  it('exposes aria-valuetext as a human string', () => {
    const { slider } = renderSlider();

    expect(slider).toHaveAttribute('aria-valuetext', '74 percent');
  });

  it('names the control after the app it controls', () => {
    const { slider } = renderSlider();

    expect(slider).toHaveAttribute('aria-label', 'Volume for Spotify');
  });

  /** Arrow keys move 1%. */
  it('steps by one percent with the arrow keys', async () => {
    const user = userEvent.setup();
    const { onVolumeChange, slider } = renderSlider();

    slider.focus();
    await user.keyboard('{ArrowRight}');

    expect(onVolumeChange).toHaveBeenCalledWith(0.75);

    await user.keyboard('{ArrowLeft}');

    expect(onVolumeChange).toHaveBeenLastCalledWith(0.73);
  });

  /** Shift plus an arrow key moves 10%. */
  it('steps by ten percent with shift held', async () => {
    const user = userEvent.setup();
    const { onVolumeChange, slider } = renderSlider();

    slider.focus();
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');

    expect(onVolumeChange).toHaveBeenCalledWith(0.84);
  });

  it('commits on key-up so a keyboard change is never left uncommitted', async () => {
    const user = userEvent.setup();
    const { onVolumeCommit, slider } = renderSlider();

    slider.focus();
    await user.keyboard('{ArrowRight}');

    expect(onVolumeCommit).toHaveBeenCalledWith(0.75);
  });

  it('clamps an out-of-range scalar rather than overflowing the track', () => {
    const { slider } = renderSlider({ volume: 4 });

    expect(slider).toHaveAttribute('aria-valuenow', '100');
  });

  /**
   * Drained, not recoloured. The master's fill is a gradient, which is a background image and
   * cannot tween to a flat colour, so a colour swap would make the two sliders mute differently.
   */
  it('drains the range when muted rather than swapping its fill', () => {
    const { container } = render(
      <VolumeSlider
        volume={0.5}
        label="Volume for Spotify"
        isMuted
        onVolumeChange={vi.fn()}
      />,
    );

    expect(container.firstElementChild).toHaveClass(
      '[&_[data-slot=slider-range]]:grayscale',
      '[&_[data-slot=slider-range]]:opacity-45',
    );
  });

  it('uses the primary fill when not muted', () => {
    const { container } = render(
      <VolumeSlider volume={0.5} label="Volume for Spotify" onVolumeChange={vi.fn()} />,
    );

    expect(container.firstElementChild).toHaveClass(
      '[&_[data-slot=slider-range]]:bg-primary',
    );
  });

  /**
   * No transition on thumb POSITION during a drag; 140 ms on scale and shadow only. A
   * transition on translate would lag the pointer, which reads as the control fighting back.
   */
  it('transitions only transform and shadow on the thumb, never position', () => {
    const { container } = render(
      <VolumeSlider volume={0.5} label="Volume for Spotify" onVolumeChange={vi.fn()} />,
    );

    const root = container.firstElementChild;

    expect(root).toHaveClass(
      '[&_[data-slot=slider-thumb]]:transition-[transform,box-shadow]',
      '[&_[data-slot=slider-thumb]]:duration-[140ms]',
    );
    expect(root?.className).not.toContain('transition-all');
    expect(root?.className).not.toContain('transition-[left');
  });

  /** The focus ring is keyboard-only and offsets against `popover`, the surface behind it. */
  it('offsets its focus ring against the popover surface', () => {
    const { container } = render(
      <VolumeSlider volume={0.5} label="Volume for Spotify" onVolumeChange={vi.fn()} />,
    );

    expect(container.firstElementChild).toHaveClass(
      '[&_[data-slot=slider-thumb]]:focus-visible:ring-offset-background',
    );
  });

  /**
   * The system volume reaches us as periodic samples, not a continuous stream. Without easing
   * between them the thumb visibly steps.
   */
  it('eases the thumb when the value is arriving from outside', () => {
    const { container } = render(
      <VolumeSlider volume={0.5} label="Volume for Spotify" hasSmoothMotion onVolumeChange={vi.fn()} />,
    );

    const root = container.firstElementChild;

    expect(root).toHaveClass(
      '[&_[data-slot=slider-range]]:transition-[left,right,filter,opacity]',
      '[&_span:has(>[data-slot=slider-thumb])]:transition-[left]',
    );
  });

  /** Any transition during a drag lags the pointer, which reads as the control fighting back. */
  it('never eases while the pointer is driving the slider', () => {
    const { container } = render(
      <VolumeSlider volume={0.5} label="Volume for Spotify" onVolumeChange={vi.fn()} />,
    );

    const className = container.firstElementChild?.className ?? '';

    expect(className).not.toContain('slider-range]]:transition-[left,right]');
    expect(className).not.toContain('slider-thumb])]:transition-[left]');
  });

  it('drops the easing under prefers-reduced-motion', () => {
    const { container } = render(
      <VolumeSlider volume={0.5} label="Volume for Spotify" hasSmoothMotion onVolumeChange={vi.fn()} />,
    );

    expect(container.firstElementChild).toHaveClass(
      'motion-reduce:[&_[data-slot=slider-range]]:transition-none',
      'motion-reduce:[&_span:has(>[data-slot=slider-thumb])]:transition-none',
    );
  });

  it('is inert when disabled', async () => {
    const user = userEvent.setup();
    const { onVolumeChange, slider } = renderSlider({ isDisabled: true });

    slider.focus();
    await user.keyboard('{ArrowRight}');

    expect(onVolumeChange).not.toHaveBeenCalled();
  });
});
