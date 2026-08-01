import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState } from '@/components/common/EmptyState';
import { CapabilityNotice } from '@/features/mixer/components/CapabilityNotice';
import type { PlatformCapabilities } from '@/types/ipc';

const masterOnly = (reason: string | null): PlatformCapabilities => ({
  hasPerAppVolume: false,
  hasPerAppMute: false,
  hasPerAppMeter: false,
  needsAudioPermission: false,
  hasPerAppRouting: false,
  unsupportedReason: reason,
});

describe('EmptyState', () => {
  it('renders its headline and subline', () => {
    render(<EmptyState headline="No audio playing" subline="Start an app to see it here" />);

    expect(screen.getByText('No audio playing')).toBeInTheDocument();
    expect(screen.getByText('Start an app to see it here')).toBeInTheDocument();
  });

  it('offers refresh only when a handler is supplied', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();

    const { rerender } = render(<EmptyState headline="No audio playing" subline="Nothing yet" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<EmptyState headline="No audio playing" subline="Nothing yet" onRefresh={onRefresh} />);
    await user.click(screen.getByRole('button', { name: /Refresh/ }));

    expect(onRefresh).toHaveBeenCalledOnce();
  });

  /** Never gradient-fill a stroke icon — it breaks currentColor and the theme swap with it. */
  /**
   * One symbol in the mark. A glyph per state put two in the same badge, and on the permission
   * state that glyph was the shield the button below already carried.
   */
  it('marks itself with the equaliser and no competing glyph', () => {
    const { container } = render(<EmptyState headline="No audio" subline="Nothing yet" />);

    expect(screen.getByTestId('empty-state-equalizer')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('CapabilityNotice', () => {
  /** The reason belongs to the backend and is rendered verbatim. */
  it('renders unsupportedReason verbatim', () => {
    const reason =
      'macOS does not expose per-app volume control. Somul controls the system output instead.';

    render(<CapabilityNotice capabilities={masterOnly(reason)} />);

    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('falls back to a plain explanation when the backend supplies none', () => {
    render(<CapabilityNotice capabilities={masterOnly(null)} />);

    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'Per-app volume control is not available on this system',
    );
  });

  /**
   * The failure this guards against: rendering dead sliders instead of a notice. An empty state
   * that explains the limit is honest; a row of disabled controls is not.
   */
  it('renders ZERO session rows and zero controls when per-app volume is absent', () => {
    render(<CapabilityNotice capabilities={masterOnly('macOS exposes master volume only.')} />);

    expect(screen.queryAllByTestId('app-audio-row')).toHaveLength(0);
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
