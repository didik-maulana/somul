import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SessionDeviceSelector } from '@/features/mixer/components/SessionDeviceSelector';
import type { AudioDevice, DeviceId } from '@/types/ipc';

const devices: AudioDevice[] = [
  {
    deviceId: 'mock:speakers' as DeviceId,
    name: 'MacBook Pro Speakers',
    isDefault: true,
    isAvailable: true,
  },
  {
    deviceId: 'mock:airpods' as DeviceId,
    name: 'AirPods Pro',
    isDefault: false,
    isAvailable: true,
  },
];

const renderSelector = (deviceId: DeviceId | null = null) => {
  const onDeviceSelect = vi.fn();

  render(
    <SessionDeviceSelector
      appName="Spotify"
      devices={devices}
      deviceId={deviceId}
      onDeviceSelect={onDeviceSelect}
    />,
  );

  return { onDeviceSelect, user: userEvent.setup() };
};

describe('SessionDeviceSelector', () => {
  /// Named as what it is rather than as the device it resolves to today. Showing the device name
  /// makes an unrouted row indistinguishable from one pinned to that device, and the two behave
  /// differently the moment the system output changes.
  it('says it follows the system on a row that was never routed', () => {
    const trigger = () => screen.getByTestId('session-device-selector');

    renderSelector();

    expect(trigger()).toHaveTextContent('System default');
    expect(trigger()).not.toHaveTextContent('MacBook Pro Speakers');
    expect(trigger()).toHaveAttribute('data-routed', 'false');
  });

  it('marks a routed row, so a moved app is visible without opening the picker', () => {
    renderSelector('mock:airpods' as DeviceId);

    const trigger = screen.getByTestId('session-device-selector');

    expect(trigger).toHaveTextContent('AirPods Pro');
    expect(trigger).toHaveAttribute('data-routed', 'true');
  });

  it('falls back to the default when the routed device has been unplugged', () => {
    renderSelector('mock:gone' as DeviceId);

    // The backend is already playing it on the default, so naming the missing device would be
    // the one thing the row must not say.
    expect(screen.getByTestId('session-device-selector')).toHaveTextContent('System default');
  });

  /// Two entries that resolve to the same device today and diverge tomorrow. Following means the
  /// app moves when the system output moves; pinning means it stays. Both have to be offered, or
  /// there is no way to say "leave this one here whatever I do with the master".
  it('offers the current default both as a device to pin to and as the system to follow', async () => {
    const { user } = renderSelector();

    await user.click(screen.getByTestId('session-device-selector'));

    expect(screen.getByRole('button', { name: 'MacBook Pro Speakers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /System default/ })).toBeInTheDocument();
  });

  it('pins to the current default when it is picked by name', async () => {
    const { onDeviceSelect, user } = renderSelector();

    await user.click(screen.getByTestId('session-device-selector'));
    await user.click(screen.getByRole('button', { name: 'MacBook Pro Speakers' }));

    // The device id, not null. Sent as null the app would follow the system, which is the
    // opposite of what picking a device by name asks for.
    expect(onDeviceSelect).toHaveBeenCalledWith('mock:speakers');
  });

  it('keeps a pinned device listed even once it becomes the system default', async () => {
    const onDeviceSelect = vi.fn();

    render(
      <SessionDeviceSelector
        appName="Spotify"
        devices={devices}
        deviceId={'mock:speakers' as DeviceId}
        onDeviceSelect={onDeviceSelect}
      />,
    );

    await userEvent.setup().click(screen.getByTestId('session-device-selector'));

    // Still pinned, not following. Dropping it from the list would leave no way to see that or
    // undo it.
    expect(screen.getByRole('button', { name: 'MacBook Pro Speakers' })).toBeInTheDocument();
  });

  it('reports the device the user picked', async () => {
    const { onDeviceSelect, user } = renderSelector();

    await user.click(screen.getByTestId('session-device-selector'));
    await user.click(screen.getByRole('button', { name: 'AirPods Pro' }));

    expect(onDeviceSelect).toHaveBeenCalledWith('mock:airpods');
  });

  it('reports null for the system default, which is a different promise from its device', async () => {
    const { onDeviceSelect, user } = renderSelector('mock:airpods' as DeviceId);

    await user.click(screen.getByTestId('session-device-selector'));
    await user.click(screen.getByRole('button', { name: /System default/ }));

    expect(onDeviceSelect).toHaveBeenCalledWith(null);
  });
});
