export type UpdatePhase =
  /** Nothing known yet. The launch check is in flight, and says so to nobody. */
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'installing'
  /** Downloaded and written to disk. The build in memory is still the old one. */
  | 'installed'
  | 'failed';

export interface UpdateStatus {
  phase: UpdatePhase;
  /** The running build. Read from the app itself, so it survives a failed check. */
  currentVersion: string | null;
  /** Set only from `available` onwards. */
  availableVersion: string | null;
  /** Release notes for {@link UpdateStatus.availableVersion}, when the manifest carried any. */
  notes: string | null;
  /**
   * How much of the download has arrived, 0–1.
   *
   * Null while nothing is downloading, and also during a download the server gave no length for —
   * the bar has to fall back to an indeterminate one rather than invent a position.
   */
  downloadFraction: number | null;
  /** Why the last install failed, when the backend could say. Null outside `failed`. */
  reason: string | null;
}
