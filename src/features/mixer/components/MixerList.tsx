import type React from 'react';

import { EmptyState } from '@/components/common/EmptyState';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AppAudioRow } from '@/features/mixer/components/AppAudioRow';
import { AudioPermissionNotice } from '@/features/mixer/components/AudioPermissionNotice';
import { CapabilityNotice } from '@/features/mixer/components/CapabilityNotice';
import type { AudioPermissionFlow } from '@/features/mixer/hooks/useAudioPermissionFlow';
import type { AudioSession, PlatformCapabilities, SessionId } from '@/types/ipc';

export interface MixerListProps {
  capabilities: PlatformCapabilities | null;
  sessions: AudioSession[];
  draggingSessionIds: ReadonlySet<SessionId>;
  onVolumeChange: (session: AudioSession, volume: number) => void;
  onVolumeCommit: (session: AudioSession, volume: number) => void;
  onMuteToggle: (session: AudioSession) => void;
  onRefresh: () => void;
  /** Grouped rather than passed as loose callbacks: the phase and its two actions only make sense together. */
  audioPermission: AudioPermissionFlow;
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
  onVolumeChange,
  onVolumeCommit,
  onMuteToggle,
  onRefresh,
  audioPermission,
}) => {
  if (capabilities === null) {
    return <div data-testid="mixer-loading" className="flex-1" aria-busy="true" />;
  }

  if (!capabilities.hasPerAppVolume) {
    return <CapabilityNotice capabilities={capabilities} />;
  }

  // Ahead of the empty state: "no apps are playing" would be the wrong answer when the truth is
  // that Somul cannot hear the ones that are.
  if (capabilities.needsAudioPermission) {
    return (
      <AudioPermissionNotice
        capabilities={capabilities}
        phase={audioPermission.phase}
        onOpenSettings={audioPermission.openSettings}
        onRelaunch={audioPermission.relaunch}
      />
    );
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        headline="No audio playing"
        subline="Apps appear here the moment they play a sound. Ones that only hold the speaker open stay out of the way."
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center justify-between px-1 pt-0.5 text-muted-foreground">
        <span className="text-micro font-semibold uppercase tracking-wider text-muted-foreground/75">Applications</span>
      </div>

      <ScrollArea className="min-h-0 flex-1 overscroll-contain" data-testid="mixer-scroll">
        <ul className="flex flex-col gap-1">
          {sessions.map((session) => (
            <li key={session.sessionId}>
              <AppAudioRow
                session={session}
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
    </div>
  );
};
