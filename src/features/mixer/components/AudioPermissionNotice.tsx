import type { FC } from 'react';
import { RotateCw, ShieldCheck, type LucideIcon } from 'lucide-react';

import { EmptyState, type EmptyStateAction } from '@/components/common/EmptyState';
import type { AudioPermissionPhase } from '@/features/mixer/hooks/useAudioPermissionFlow';
import type { PlatformCapabilities } from '@/types/ipc';

export interface AudioPermissionNoticeProps {
  capabilities: PlatformCapabilities;
  phase: AudioPermissionPhase;
  onOpenSettings: () => void;
  onRelaunch: () => void;
}

const FALLBACK_REASON =
  'Somul has not heard any app audio yet. macOS only lets an app capture other apps’ audio once you allow it, and per-app volume needs that access.';

const SETTINGS_LABEL = 'Open Privacy Settings';

interface PhaseCopy {
  headline: string;
  /**
   * `null` defers to the adapter's own words, for the same reason {@link CapabilityNotice} renders
   * them verbatim — paraphrasing lets the UI and the backend drift apart.
   *
   * The relaunch phase is the exception. By then the backend's reason describes what it observed,
   * which is still true and no longer the point: the user has done their part, and repeating that
   * nothing has been heard reads as the app not having noticed.
   */
  subline: string | null;
  primaryLabel: string;
  primaryIcon: LucideIcon;
}

const PHASE_COPY: Record<AudioPermissionPhase, PhaseCopy> = {
  unrequested: {
    headline: 'Allow Somul to hear your apps',
    subline: null,
    primaryLabel: SETTINGS_LABEL,
    primaryIcon: ShieldCheck,
  },
  awaiting: {
    headline: 'Waiting for macOS',
    subline:
      'Somul is asking again every few seconds. If you have just allowed it under Screen & System Audio Recording, this clears on its own.',
    primaryLabel: SETTINGS_LABEL,
    primaryIcon: ShieldCheck,
  },
  relaunchRequired: {
    headline: 'Relaunch to finish',
    subline:
      'macOS hands audio access to an app when it starts, so a permission allowed just now reaches Somul on its next launch. Nothing else is missing.',
    primaryLabel: 'Relaunch Somul',
    primaryIcon: RotateCw,
  },
};

/**
 * What the panel renders instead of the session list while audio capture is not granted.
 *
 * Every row would be uncontrollable until the permission lands, and a list of apps whose sliders
 * move nothing reads as several bugs rather than one missing checkbox. It also lists apps that
 * are not playing at all: without capture there is no way to tell an app holding an open output
 * stream apart from one making sound, so the list would be wrong as well as inert.
 *
 * The phase is what stops this state becoming the dead end it used to be. Granting the permission
 * changes nothing a running Somul can see, so a user who allowed it came back to the same empty
 * panel and the same button they had already pressed — which is how a missing restart reads as a
 * broken app. `relaunchRequired` says what happened and offers the only thing that finishes it.
 */
export const AudioPermissionNotice: FC<AudioPermissionNoticeProps> = ({
  capabilities,
  phase,
  onOpenSettings,
  onRelaunch,
}) => {
  const copy = PHASE_COPY[phase];
  const isRelaunch = phase === 'relaunchRequired';

  const action: EmptyStateAction = {
    label: copy.primaryLabel,
    icon: copy.primaryIcon,
    onClick: isRelaunch ? onRelaunch : onOpenSettings,
  };

  // Kept behind the relaunch offer for the user it guesses wrong about: someone who opened
  // Settings, allowed nothing, and would otherwise have restarted for no reason with no way back
  // to the checkbox.
  const secondaryAction: EmptyStateAction | undefined = isRelaunch
    ? { label: SETTINGS_LABEL, icon: ShieldCheck, onClick: onOpenSettings }
    : undefined;

  return (
    <EmptyState
      headline={copy.headline}
      subline={copy.subline ?? capabilities.unsupportedReason ?? FALLBACK_REASON}
      action={action}
      secondaryAction={secondaryAction}
    />
  );
};
