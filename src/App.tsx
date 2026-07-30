import { useCallback, type FC } from 'react';

import { PanelFooter } from '@/components/common/PanelFooter';
import { PanelHeader } from '@/components/common/PanelHeader';
import { PanelShell } from '@/components/common/PanelShell';
import { DeviceSelector } from '@/features/master/components/DeviceSelector';
import { MasterVolumeCard } from '@/features/master/components/MasterVolumeCard';
import { useMasterVolume } from '@/features/master/hooks/useMasterVolume';
import { useOutputDevices } from '@/features/master/hooks/useOutputDevices';
import { MixerList } from '@/features/mixer/components/MixerList';
import { useAudioSessions } from '@/features/mixer/hooks/useAudioSessions';
import { usePeakStream } from '@/features/mixer/hooks/usePeakStream';
import { useVolumeCommit } from '@/features/mixer/hooks/useVolumeCommit';
import { setPanelPinned as setPanelPinnedOnBackend } from '@/lib/ipc';
import { useAudioStore } from '@/stores/audioStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { AudioSession } from '@/types/ipc';

/**
 * Composition only. No `invoke` call appears in this file or in any component file — every IPC
 * round trip goes through a feature hook.
 */
export const App: FC = () => {
  const peakStream = usePeakStream();
  const sessions = useAudioSessions();
  const master = useMasterVolume();
  const devices = useOutputDevices();

  const draggingSessionIds = useAudioStore((state) => state.draggingSessionIds);
  const isDraggingMaster = useAudioStore((state) => state.isDraggingMaster);
  const capabilities = useAudioStore((state) => state.capabilities);
  const hotkey = useSettingsStore((state) => state.hotkey);
  const isPanelPinned = useSettingsStore((state) => state.isPanelPinned);
  const setPanelPinned = useSettingsStore((state) => state.setPanelPinned);

  const sessionCommit = useVolumeCommit(
    useCallback(
      (volume: number) => {
        const [dragging] = draggingSessionIds;

        if (dragging) {
          void sessions.commitVolume(dragging, volume);
        }
      },
      [draggingSessionIds, sessions],
    ),
  );

  const masterCommit = useVolumeCommit(
    useCallback(
      (volume: number) => {
        void master.commitVolume(volume);
      },
      [master],
    ),
  );

  const handleSessionVolumeChange = useCallback(
    (session: AudioSession, volume: number) => {
      sessions.startDragging(session.sessionId);
      sessions.changeVolume(session.sessionId, volume);
      sessionCommit.change(volume);
    },
    [sessionCommit, sessions],
  );

  const handleSessionVolumeCommit = useCallback(
    (session: AudioSession, volume: number) => {
      sessions.changeVolume(session.sessionId, volume);
      void sessions.commitVolume(session.sessionId, volume);
      sessions.stopDragging(session.sessionId);
    },
    [sessions],
  );

  const handleMasterVolumeChange = useCallback(
    (volume: number) => {
      master.changeVolume(volume);
      masterCommit.change(volume);
    },
    [master, masterCommit],
  );

  return (
    <PanelShell
      header={
        <PanelHeader
          isPinned={isPanelPinned}
          onPinToggle={() => {
            const next = !isPanelPinned;

            setPanelPinned(next);
            // The backend owns the focus-loss rule, so the store alone would leave the button
            // looking active while the panel still vanished on click-away.
            void setPanelPinnedOnBackend(next);
          }}
          onSettingsOpen={() => undefined}
        />
      }
      footer={<PanelFooter activeSessionCount={sessions.sessions.length} hotkey={hotkey} />}
    >
      {master.master && (
        <MasterVolumeCard
          master={master.master}
          onVolumeChange={handleMasterVolumeChange}
          onVolumeCommit={masterCommit.flush}
          hasSmoothMotion={!isDraggingMaster && !master.isResyncing}
          deviceSelector={
            <DeviceSelector
              devices={devices.devices}
              onDeviceSelect={(deviceId) => {
                void devices.selectDevice(deviceId);
              }}
            />
          }
        />
      )}

      <div className="mt-2 flex min-h-0 flex-1 flex-col">
        <MixerList
          capabilities={capabilities}
          sessions={sessions.sessions}
          peakStream={peakStream}
          draggingSessionIds={draggingSessionIds}
          onVolumeChange={handleSessionVolumeChange}
          onVolumeCommit={handleSessionVolumeCommit}
          onMuteToggle={(session) => {
            void sessions.toggleMute(session);
          }}
          onRefresh={sessions.refresh}
        />
      </div>
    </PanelShell>
  );
};
