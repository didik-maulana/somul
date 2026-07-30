import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DeviceSelector } from '@/features/master/components/DeviceSelector';
import type { AudioDevice, DeviceId } from '@/types/ipc';

const devices: AudioDevice[] = [
  {
    deviceId: 'mock:speakers' as DeviceId,
    name: 'Built-in Speakers',
    isDefault: true,
    isAvailable: true,
  },
  {
    deviceId: 'mock:headphones' as DeviceId,
    name: 'USB Headphones',
    isDefault: false,
    isAvailable: true,
  },
];

const open = async (onDeviceSelect = vi.fn()) => {
  const user = userEvent.setup();

  render(<DeviceSelector devices={devices} onDeviceSelect={onDeviceSelect} />);
  await user.click(screen.getByRole('button', { name: 'Change output device' }));

  return { user, onDeviceSelect };
};

describe('DeviceSelector', () => {
  it('names its trigger for screen readers', () => {
    render(<DeviceSelector devices={devices} onDeviceSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Change output device' })).toBeInTheDocument();
  });

  it('lists the output devices once opened', async () => {
    await open();

    expect(screen.getByText('Built-in Speakers')).toBeInTheDocument();
    expect(screen.getByText('USB Headphones')).toBeInTheDocument();
  });

  /** DESIGN.md §9.8: the selected item is marked, not merely coloured. */
  it('marks the current default', async () => {
    await open();

    expect(screen.getByRole('button', { name: /Built-in Speakers/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(screen.getByRole('button', { name: /USB Headphones/ })).toHaveAttribute(
      'aria-current',
      'false',
    );
  });

  it('reports the chosen device and closes', async () => {
    const { user, onDeviceSelect } = await open();

    await user.click(screen.getByRole('button', { name: /USB Headphones/ }));

    expect(onDeviceSelect).toHaveBeenCalledWith('mock:headphones');
    expect(screen.queryByText('USB Headphones')).not.toBeInTheDocument();
  });

  it('disables a device that is enumerated but unavailable', async () => {
    const user = userEvent.setup();
    const onDeviceSelect = vi.fn();

    render(
      <DeviceSelector
        devices={[
          devices[0],
          { ...devices[1], isAvailable: false },
        ]}
        onDeviceSelect={onDeviceSelect}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change output device' }));

    expect(screen.getByRole('button', { name: /USB Headphones/ })).toBeDisabled();
  });

  it('sits at e3 elevation on the popover surface', async () => {
    await open();

    expect(screen.getByText('Output device').parentElement).toHaveClass(
      'bg-popover',
      'shadow-e3',
      'rounded-lg',
    );
  });

  it('says so when nothing is available rather than rendering an empty list', async () => {
    const user = userEvent.setup();

    render(<DeviceSelector devices={[]} onDeviceSelect={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Change output device' }));

    expect(screen.getByText('No output device available')).toBeInTheDocument();
  });
});
