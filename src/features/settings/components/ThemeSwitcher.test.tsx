import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThemeSwitcher } from '@/features/settings/components/ThemeSwitcher';
import type { Theme } from '@/types/ipc';

const renderSwitcher = (theme: Theme = 'system') => {
  const onThemeChange = vi.fn();

  const { container } = render(<ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />);

  return { onThemeChange, container, user: userEvent.setup() };
};

describe('ThemeSwitcher', () => {
  it('names every option even though it renders icons', () => {
    renderSwitcher();

    for (const label of ['System', 'Dark', 'Light']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it('marks the active option', () => {
    renderSwitcher('dark');

    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'false');
  });

  it('reports a choice', async () => {
    const { onThemeChange, user } = renderSwitcher();

    await user.click(screen.getByRole('radio', { name: 'Light' }));

    expect(onThemeChange).toHaveBeenCalledWith('light');
  });

  /**
   * The track must be equal columns. Sized by their own text, "System" is wider than "Dark", so a
   * fixed-width pill translating by multiples of itself lands beside the option instead of on it.
   * That misalignment is what read as a janky slide.
   */
  it('lays the options out in equal columns', () => {
    const { container } = renderSwitcher();

    expect(container.firstElementChild).toHaveClass('grid', 'grid-cols-3');
  });

  it('moves the indicator one full column per step', () => {
    for (const [theme, offset] of [
      ['system', '0%'],
      ['dark', '100%'],
      ['light', '200%'],
    ] as const) {
      const { unmount } = render(<ThemeSwitcher theme={theme} onThemeChange={vi.fn()} />);

      expect(screen.getByTestId('theme-indicator')).toHaveStyle({
        transform: `translateX(${offset})`,
      });

      unmount();
    }
  });

  it('sizes the indicator to exactly one column', () => {
    renderSwitcher();

    expect(screen.getByTestId('theme-indicator')).toHaveStyle({
      width: 'calc((100% - 0.25rem) / 3)',
    });
  });

  /** Transform only — animating width or left would trigger layout on every frame. */
  it('animates with transform and honours reduced motion', () => {
    renderSwitcher();

    const indicator = screen.getByTestId('theme-indicator');

    expect(indicator).toHaveClass('transition-transform', 'motion-reduce:transition-none');
    expect(indicator.className).not.toContain('transition-all');
  });

  it('falls back to the first option if the stored theme is unrecognised', () => {
    render(<ThemeSwitcher theme={'chartreuse' as Theme} onThemeChange={vi.fn()} />);

    expect(screen.getByTestId('theme-indicator')).toHaveStyle({ transform: 'translateX(0%)' });
  });
});
