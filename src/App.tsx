import { useCallback, useState, type FC } from "react";

import { PanelFooter } from "@/components/common/PanelFooter";
import { PanelHeader } from "@/components/common/PanelHeader";
import { PanelShell } from "@/components/common/PanelShell";
import { DeviceSelector } from "@/features/master/components/DeviceSelector";
import { MasterVolumeCard } from "@/features/master/components/MasterVolumeCard";
import { useMasterVolume } from "@/features/master/hooks/useMasterVolume";
import { useOutputDevices } from "@/features/master/hooks/useOutputDevices";
import { MixerList } from "@/features/mixer/components/MixerList";
import { SettingsView } from "@/features/settings/components/SettingsView";
import { useSettings } from "@/features/settings/hooks/useSettings";
import { useAudioSessions } from "@/features/mixer/hooks/useAudioSessions";
import { usePeakStream } from "@/features/mixer/hooks/usePeakStream";
import { useVolumeCommit } from "@/features/mixer/hooks/useVolumeCommit";
import { DEFAULT_HOTKEY } from "@/lib/accelerator";
import { useAudioStore } from "@/stores/audioStore";
import type { AudioSession } from "@/types/ipc";

/**
 * Composition only. No `invoke` call appears in this file or in any component file — every IPC
 * round trip goes through a feature hook.
 */
export const App: FC = () => {
  const peakStream = usePeakStream();
  const sessions = useAudioSessions();
  const master = useMasterVolume();
  const devices = useOutputDevices();

  const [isShowingSettings, setIsShowingSettings] = useState(false);
  const settings = useSettings();

  const draggingSessionIds = useAudioStore((state) => state.draggingSessionIds);
  const isDraggingMaster = useAudioStore((state) => state.isDraggingMaster);
  const capabilities = useAudioStore((state) => state.capabilities);

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
          onSettingsOpen={() => {
            setIsShowingSettings((isShowing) => !isShowing);
          }}
        />
      }
      footer={
        <PanelFooter
          activeSessionCount={sessions.sessions.length}
          hotkey={settings.settings?.hotkey ?? DEFAULT_HOTKEY}
        />
      }
    >
      {/* Settings takes the whole panel. The master card is a control, and leaving it above a
          settings form makes the panel read as two screens at once. */}
      {!isShowingSettings && master.master && (
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
        {isShowingSettings ? (
          <SettingsView
            settings={settings.settings}
            hotkeyWarning={settings.hotkeyWarning}
            onSettingsChange={settings.change}
            onClose={() => {
              setIsShowingSettings(false);
            }}
          />
        ) : (
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
        )}
      </div>
    </PanelShell>
  );
};
