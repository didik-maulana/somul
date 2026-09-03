import { useState, type FC } from 'react';
import { Check, ChevronDown, Headphones, Laptop, Monitor, Speaker } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { resolveDeviceKind, type DeviceKind } from '@/features/master/lib/deviceIcon';
import { cn } from '@/lib/utils';
import type { AudioDevice, DeviceId } from '@/types/ipc';

export interface SessionDeviceSelectorProps {
  appName: string;
  devices: AudioDevice[];
  /** Null when the app follows the system default rather than a device of its own. */
  deviceId: DeviceId | null;
  isDisabled?: boolean;
  onDeviceSelect: (deviceId: DeviceId | null) => void;
}

const KIND_ICON: Record<DeviceKind, typeof Speaker> = {
  headphones: Headphones,
  display: Monitor,
  laptop: Laptop,
  speaker: Speaker,
};

const DEFAULT_LABEL = 'System default';

/**
 * Where one app's audio goes.
 *
 * Reads the default from `devices` rather than taking it as a prop: the default is a fact about
 * the system, and a row holding its own copy would go stale the moment the output changed
 * underneath it.
 *
 * A routed app gets a primary border and a routed-away label. Left identical to a row on the
 * default, the panel would give no way to see which apps had been moved without opening every
 * picker in the list.
 */
export const SessionDeviceSelector: FC<SessionDeviceSelectorProps> = ({
  appName,
  devices,
  deviceId,
  isDisabled = false,
  onDeviceSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const systemDefault = devices.find((device) => device.isDefault);
  const routed = deviceId === null ? undefined : devices.find((d) => d.deviceId === deviceId);
  const isRouted = routed !== undefined;

  // Named as what it is, not as the device it resolves to today. An unrouted row saying
  // "MacBook Pro Speakers" is indistinguishable from one pinned to that device, and the two
  // behave differently the moment the system output changes.
  //
  // The glyph still comes from the resolved device, so the row keeps hinting where the audio
  // actually goes. A destination whose device has been unplugged lands here too: the backend is
  // already playing it on the default, and naming the missing device would be the one thing the
  // row must not say.
  const resolved = routed ?? systemDefault;
  const Icon = KIND_ICON[resolveDeviceKind(resolved?.name ?? '')];
  const label = isRouted ? routed.name : DEFAULT_LABEL;


  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isDisabled}
          data-testid="session-device-selector"
          data-routed={isRouted}
          aria-label={`Output device for ${appName}`}
          className={cn(
            'group/route flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 outline-none',
            'transition-[background-color,border-color,color] duration-[140ms] ease-[var(--ease-standard)]',
            'focus-visible:ring-ring focus-visible:ring-2',
            'disabled:pointer-events-none disabled:opacity-50',
            isRouted
              ? 'border-primary-stroke/60 text-foreground bg-primary/10'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent',
          )}
        >
          <Icon size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span className="text-caption min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 transition-transform duration-200 ease-[var(--ease-standard)] group-data-[state=open]/route:rotate-180 motion-reduce:transition-none"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="bg-popover border-border shadow-e3 min-w-[220px] rounded-lg p-1"
      >
        <p className="text-micro text-muted-foreground px-2 py-1">Send {appName} to</p>

        <ul>
          {/* Its own entry rather than a checkmark on whichever device is default today. Picking
              the default device by name pins the app to that device; picking this follows the
              system, and the two are different promises. */}
          <li>
            <button
              type="button"
              aria-current={!isRouted}
              onClick={() => {
                onDeviceSelect(null);
                setIsOpen(false);
              }}
              className={cn(
                'text-body hover:bg-accent flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left',
                !isRouted && 'text-accent-foreground',
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {DEFAULT_LABEL}
                {systemDefault && (
                  <span className="text-muted-foreground"> · {systemDefault.name}</span>
                )}
              </span>
              {!isRouted && (
                <Check
                  size={16}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  className="text-primary-stroke shrink-0"
                />
              )}
            </button>
          </li>

          <li aria-hidden="true" className="border-border my-1 border-t" />

          {/* Every device, the current default included. Picking it by name is a different
              choice from the entry above — it pins the app there, so a later change of system
              output leaves it where it is. Hiding it took that choice away. */}
          {devices.map((device) => {
            const isSelected = device.deviceId === deviceId;

            return (
              <li key={device.deviceId}>
                <button
                  type="button"
                  disabled={!device.isAvailable}
                  aria-current={isSelected}
                  onClick={() => {
                    onDeviceSelect(device.deviceId);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'text-body hover:bg-accent flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left disabled:pointer-events-none disabled:opacity-50',
                    isSelected && 'text-accent-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{device.name}</span>
                  {isSelected && (
                    <Check
                      size={16}
                      strokeWidth={1.75}
                      aria-hidden="true"
                      className="text-primary-stroke shrink-0"
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
