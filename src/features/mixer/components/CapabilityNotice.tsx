import type React from 'react';

import { EmptyState } from '@/components/common/EmptyState';
import type { PlatformCapabilities } from '@/types/ipc';

export interface CapabilityNoticeProps {
  capabilities: PlatformCapabilities;
}

const FALLBACK_REASON =
  'Per-app volume control is not available on this system. The master output above still works.';

/**
 * ARCHITECTURE.md §2.2.5 — what the panel renders in place of the session list when the platform
 * has no per-app control.
 *
 * `unsupportedReason` is rendered **verbatim**. It is the backend's explanation of a platform
 * limit, and paraphrasing it here would let the UI and the adapter drift apart.
 *
 * An empty state that explains the limitation is honest. A row of dead sliders is not — which is
 * why nothing in this component renders a session row.
 */
export const CapabilityNotice: React.FC<CapabilityNoticeProps> = ({ capabilities }) => (
  <EmptyState
    headline="Per-app mixing unavailable"
    subline={capabilities.unsupportedReason ?? FALLBACK_REASON}
  />
);
