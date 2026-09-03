import type React from 'react';

import { ShieldCheck } from 'lucide-react';

import { EmptyState } from '@/components/common/EmptyState';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AppAudioRow } from '@/features/mixer/components/AppAudioRow';
import { CapabilityNotice } from '@/features/mixer/components/CapabilityNotice';
import { usePeakMeters } from '@/features/mixer/hooks/usePeakMeters';
import type {
  AudioDevice,
  AudioSession,
  DeviceId,
  PlatformCapabilities,
  SessionId,
} from '@/types/ipc';

export interface MixerListProps {
  capabilities: PlatformCapabilities | null;
  sessions: AudioSession[];
  draggingSessionIds: ReadonlySet<SessionId>;
  /** The user's setting. Gates the meter on top of whatever the platform can do. */
  isPeakMeterEnabled: boolean;
  devices: AudioDevice[];
  onSessionDeviceSelect: (session: AudioSession, deviceId: DeviceId | null) => void;
  onVolumeChange: (session: AudioSession, volume: number) => void;
  onVolumeCommit: (session: AudioSession, volume: number) => void;
  onMuteToggle: (session: AudioSession) => void;
  onRefresh: () => void;
  /** Always available: the permission cannot be detected, only offered. */
  onOpenAudioPermission: () => void;
}

/**
 * The branch is on `capabilities`, never on a userAgent or an OS
 * sniff. A platform without per-app volume gets the notice and **no session rows at all** — dead
 * sliders would imply a control that does nothing.
 */
export const MixerList: React.FC<MixerListProps> = ({
  capabilities,
  sessions,
  draggingSessionIds,
  isPeakMeterEnabled,
  devices,
  onSessionDeviceSelect,
  onVolumeChange,
  onVolumeCommit,
  onMuteToggle,
  onRefresh,
  onOpenAudioPermission,
}) => {
  // Ahead of every branch below, because the branches return early and a hook cannot.
  const hasMeter = (capabilities?.hasPerAppMeter ?? false) && isPeakMeterEnabled;

  usePeakMeters(hasMeter);

  // Empty unless the platform routes, which is what keeps the picker off a row it could not move.
  const routableDevices = capabilities?.hasPerAppRouting === true ? devices : [];

  if (capabilities === null) {
    return <div data-testid="mixer-loading" className="flex-1" aria-busy="true" />;
  }

  if (!capabilities.hasPerAppVolume) {
    return <CapabilityNotice capabilities={capabilities} />;
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        headline="No audio playing"
        subline="Apps appear here the moment they play a sound. Ones that only hold the speaker open stay out of the way."
        onRefresh={onRefresh}
        // The quiet half of the answer to a permission Somul cannot detect.
        //
        // An app playing audio that Somul is not allowed to hear looks exactly like an app that
        // is not playing, so the panel never claims which one it is. It offers the door instead,
        // at the only moment the question occurs to anyone: the list is empty and they expected
        // it not to be.
        secondaryAction={{
          label: 'Not seeing an app? Check permission',
          icon: ShieldCheck,
          onClick: onOpenAudioPermission,
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center justify-between px-1 pt-0.5 text-muted-foreground">
        <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground/75">Applications</span>
      </div>

      <ScrollArea className="min-h-0 flex-1 overscroll-contain" data-testid="mixer-scroll">
        <ul className="flex flex-col gap-1.5">
          {sessions.map((session) => (
            <li key={session.sessionId}>
              <AppAudioRow
                session={session}
                isDragging={draggingSessionIds.has(session.sessionId)}
                hasMeter={hasMeter}
                devices={routableDevices}
                onDeviceSelect={(deviceId) => {
                  onSessionDeviceSelect(session, deviceId);
                }}
                onVolumeChange={(volume) => {
                  onVolumeChange(session, volume);
                }}
                onVolumeCommit={(volume) => {
                  onVolumeCommit(session, volume);
                }}
                onMuteToggle={() => {
                  onMuteToggle(session);
                }}
              />
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
};
