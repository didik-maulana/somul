import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MasterVolumeCard } from '@/features/master/components/MasterVolumeCard';
import type { DeviceId, MasterState } from '@/types/ipc';

const master: MasterState = {
  deviceId: 'mock:speakers' as DeviceId,
  deviceName: 'Built-in Speakers',
  volume: 0.62,
  isMuted: false,
};

const renderCard = (overrides: Partial<Parameters<typeof MasterVolumeCard>[0]> = {}) => {
  const onVolumeChange = vi.fn();
  const onVolumeCommit = vi.fn();

  render(
    <MasterVolumeCard
      master={master}
      onVolumeChange={onVolumeChange}
      onVolumeCommit={onVolumeCommit}
      {...overrides}
    />,
  );

  return { onVolumeChange, onVolumeCommit };
};

describe('MasterVolumeCard', () => {
  it('names its device and shows the level readout', () => {
    renderCard();

    expect(screen.getByText('Built-in Speakers')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
  });

  it('sits on an e1 card surface', () => {
    renderCard();

    expect(screen.getByTestId('master-volume-card')).toHaveClass(
      'bg-card',
      'border',
      'border-border',
      'rounded-lg',
    );
  });

  /**
   * DESIGN.md §9.3 and §12: the signature gradient on the master fill is the one element
   * outranking the app rows, and one of only four permitted uses of the gradient.
   */
  it('fills its slider with the signature gradient rather than flat primary', () => {
    const { container } = render(
      <MasterVolumeCard master={master} onVolumeChange={vi.fn()} onVolumeCommit={vi.fn()} />,
    );

    const slider = container.querySelector('[data-slot="slider"]');

    expect(slider).toHaveClass('[&_[data-slot=slider-range]]:bg-signature');
  });

  it('names the master slider for screen readers', () => {
    renderCard();

    expect(screen.getByRole('slider')).toHaveAttribute(
      'aria-label',
      'Master volume for Built-in Speakers',
    );
  });

  it('reports changes and commits separately', async () => {
    const user = userEvent.setup();
    const { onVolumeChange, onVolumeCommit } = renderCard();

    screen.getByRole('slider').focus();
    await user.keyboard('{ArrowRight}');

    expect(onVolumeChange).toHaveBeenCalledWith(0.63);
    expect(onVolumeCommit).toHaveBeenCalledWith(0.63);
  });

  it('hosts the device selector when one is supplied', () => {
    renderCard({ deviceSelector: <button type="button">Change output</button> });

    expect(screen.getByRole('button', { name: 'Change output' })).toBeInTheDocument();
  });
});
