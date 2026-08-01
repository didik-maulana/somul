import type { FC } from 'react';
import { ShieldCheck } from 'lucide-react';

import { EmptyState } from '@/components/common/EmptyState';
import type { PlatformCapabilities } from '@/types/ipc';

export interface AudioPermissionNoticeProps {
  capabilities: PlatformCapabilities;
  onOpenSettings: () => void;
}

const FALLBACK_REASON =
  'Somul has not heard any app audio yet. macOS only lets an app capture other apps’ audio once you allow it, and per-app volume needs that access.';

/**
 * What the panel renders instead of the session list while audio capture is not granted.
 *
 * Every row would be uncontrollable until the permission lands, and a list of apps whose sliders
 * move nothing reads as several bugs rather than one missing checkbox. It also lists apps that
 * are not playing at all: without capture there is no way to tell an app holding an open output
 * stream apart from one making sound, so the list would be wrong as well as inert.
 *
 * `unsupportedReason` is rendered verbatim, for the same reason it is in
 * {@link CapabilityNotice} — paraphrasing lets the UI and the adapter drift apart.
 */
export const AudioPermissionNotice: FC<AudioPermissionNoticeProps> = ({
  capabilities,
  onOpenSettings,
}) => (
  <EmptyState
    icon={ShieldCheck}
    headline="Allow Somul to hear your apps"
    subline={capabilities.unsupportedReason ?? FALLBACK_REASON}
    action={{ label: 'Open Privacy Settings', icon: ShieldCheck, onClick: onOpenSettings }}
  />
);
