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
  isVolumeControllable: true,
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
   * The signature gradient on the master fill is the one element outranking the app rows, and
   * one of only three permitted uses of the gradient anywhere in the app.
   */
  it('fills its slider with the signature gradient rather than flat primary', () => {
    const { container } = render(
      <MasterVolumeCard master={master} onVolumeChange={vi.fn()} onVolumeCommit={vi.fn()} />,
    );

    const slider = container.querySelector('[data-slot="slider"]');

    expect(slider).toHaveClass('[&_[data-slot=slider-range]]:bg-signature');
  });

  it('carries a glyph for the device it is driving', () => {
    renderCard();

    expect(screen.getByTestId('master-device-icon')).toBeInTheDocument();
  });

  /** Muting silences the output but does not reset it, so the level it returns to stays visible. */
  it('keeps the level on screen when muted, alongside the muted chip', () => {
    renderCard({ master: { ...master, isMuted: true } });

    expect(screen.getByTestId('master-muted-chip')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
  });

  it('drains the slider fill while muted rather than swapping it for a flat colour', () => {
    const { container } = render(
      <MasterVolumeCard
        master={{ ...master, isMuted: true }}
        onVolumeChange={vi.fn()}
        onVolumeCommit={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-slot="slider"]')).toHaveClass(
      '[&_[data-slot=slider-range]]:grayscale',
    );
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

  /**
   * Aggregates, HDMI, and many USB DACs keep gain in hardware. `volume` reads as unity there
   * because nothing is attenuating — showing that as a live 100% slider is what made a fresh
   * install look like Somul had overridden the volume.
   */
  describe('a device with no software volume', () => {
    const hardwareGain = { ...master, volume: 1, isVolumeControllable: false };

    it('disables the slider instead of showing a live 100%', () => {
      renderCard({ master: hardwareGain });

      expect(screen.getByRole('slider')).toHaveAttribute('data-disabled');
    });

    it('shows no percentage, since there is no level to report', () => {
      renderCard({ master: hardwareGain });

      expect(screen.queryByText('100%')).not.toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('explains where the volume actually lives', () => {
      renderCard({ master: hardwareGain });

      expect(screen.getByText(/controls its volume in hardware/)).toBeInTheDocument();
    });

    it('still names the device', () => {
      renderCard({ master: hardwareGain });

      expect(screen.getByText('Built-in Speakers')).toBeInTheDocument();
    });
  });

  it('keeps the slider live on a normal device', () => {
    renderCard();

    expect(screen.getByRole('slider')).not.toHaveAttribute('data-disabled');
    expect(screen.getByText('62%')).toBeInTheDocument();
  });

  it('hosts the device selector when one is supplied', () => {
    renderCard({ deviceSelector: <button type="button">Change output</button> });

    expect(screen.getByRole('button', { name: 'Change output' })).toBeInTheDocument();
  });

  it('names itself the default, so a routed row reads as the exception', () => {
    renderCard();

    expect(screen.getByTestId('master-default-chip')).toHaveTextContent('DEFAULT');
  });
});
