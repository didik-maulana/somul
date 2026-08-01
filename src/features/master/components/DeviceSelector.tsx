import { useState, type FC } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { AudioDevice, DeviceId } from '@/types/ipc';

export interface DeviceSelectorProps {
  devices: AudioDevice[];
  onDeviceSelect: (deviceId: DeviceId) => void;
}

/**
 * A Radix Popover at `e3` elevation.
 *
 * v1 selects the **default output device** only. Per-session routing is v1.1, so there is
 * deliberately no per-row variant of this control: building UI for an unshipped capability is
 * how a panel ends up with a picker that cannot route anything.
 */
export const DeviceSelector: FC<DeviceSelectorProps> = ({ devices, onDeviceSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selected = devices.find((device) => device.isDefault);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="group/device text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground size-7 shrink-0 rounded-md transition-[transform,background-color,color] duration-[140ms] ease-[var(--ease-standard)] active:scale-90 motion-reduce:active:scale-100"
          aria-label="Change output device"
        >
          {/* Chevron alone: the card already carries a glyph for the device type, and a second
              device icon on the trigger read as a second device rather than as a picker. */}
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className="transition-transform duration-200 ease-[var(--ease-standard)] group-data-[state=open]/device:rotate-180 motion-reduce:transition-none"
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="bg-popover border-border shadow-e3 min-w-[220px] rounded-lg p-1"
      >
        <p className="text-micro text-muted-foreground px-2 py-1">Output device</p>

        <ul>
          {devices.map((device) => (
            <li key={device.deviceId}>
              <button
                type="button"
                disabled={!device.isAvailable}
                aria-current={device.isDefault}
                onClick={() => {
                  onDeviceSelect(device.deviceId);
                  setIsOpen(false);
                }}
                className={cn(
                  'text-body hover:bg-accent flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left disabled:pointer-events-none disabled:opacity-50',
                  device.isDefault && 'text-accent-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{device.name}</span>
                {device.isDefault && (
                  <Check
                    size={16}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className="text-primary-stroke shrink-0"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>

        {selected === undefined && (
          <p className="text-caption text-muted-foreground px-2 py-1">No output device available</p>
        )}
      </PopoverContent>
    </Popover>
  );
};
