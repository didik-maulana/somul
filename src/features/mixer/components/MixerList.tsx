import type React from 'react';

import { EmptyState } from '@/components/common/EmptyState';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AppAudioRow } from '@/features/mixer/components/AppAudioRow';
import { CapabilityNotice } from '@/features/mixer/components/CapabilityNotice';
import type { PeakStream } from '@/features/mixer/hooks/usePeakStream';
import type { AudioSession, PlatformCapabilities, SessionId } from '@/types/ipc';

export interface MixerListProps {
  capabilities: PlatformCapabilities | null;
  sessions: AudioSession[];
  peakStream: PeakStream;
  draggingSessionIds: ReadonlySet<SessionId>;
  onVolumeChange: (session: AudioSession, volume: number) => void;
  onVolumeCommit: (session: AudioSession, volume: number) => void;
  onMuteToggle: (session: AudioSession) => void;
  onRefresh: () => void;
}

/**
 * The branch is on `capabilities`, never on a userAgent or an OS
 * sniff. A platform without per-app volume gets the notice and **no session rows at all** — dead
 * sliders would imply a control that does nothing.
 */
export const MixerList: React.FC<MixerListProps> = ({
  capabilities,
  sessions,
  peakStream,
  draggingSessionIds,
  onVolumeChange,
  onVolumeCommit,
  onMuteToggle,
  onRefresh,
}) => {
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
        subline="Apps appear here as soon as they start playing sound."
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1 overscroll-contain" data-testid="mixer-scroll">
      <ul className="flex flex-col gap-1">
        {sessions.map((session) => (
          <li key={session.sessionId}>
            <AppAudioRow
              session={session}
              {...(capabilities.hasPerAppMeter ? { peakStream } : {})}
              isDragging={draggingSessionIds.has(session.sessionId)}
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
  );
};
