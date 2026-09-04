import { describe, expect, it } from 'vitest';

import { describeUpdate } from '@/features/update/lib/describeUpdate';
import type { UpdateStatus } from '@/features/update/types';

const status = (overrides: Partial<UpdateStatus>): UpdateStatus => ({
  phase: 'checking',
  currentVersion: null,
  availableVersion: null,
  notes: null,
  downloadFraction: null,
  reason: null,
  ...overrides,
});

describe('describeUpdate', () => {
  /** The footer already names the running build; the row repeating it says nothing new. */
  it('reports being current without quoting the version', () => {
    expect(describeUpdate(status({ phase: 'upToDate', currentVersion: '1.0.0' }))).toBe(
      'Up to date',
    );
  });

  /** "Up to date" before the check answers is a claim the app has not earned. */
  it('says nothing at all until the launch check answers', () => {
    expect(describeUpdate(status({ phase: 'idle' }))).toBeUndefined();
  });

  it('names the version waiting to be installed', () => {
    expect(
      describeUpdate(status({ phase: 'available', availableVersion: '1.1.0' })),
    ).toBe('Version 1.1.0 is ready to install');
  });

  /** The build on disk and the one running have diverged, and only a restart closes that. */
  it('asks for a restart once the update is installed', () => {
    expect(
      describeUpdate(status({ phase: 'installed', availableVersion: '1.1.0' })),
    ).toBe('Version 1.1.0 installed — restart to use it');

    expect(describeUpdate(status({ phase: 'installed' }))).toBe('Installed — restart to use it');
  });

  /** Saying nothing after a failed check would read as "up to date" on a stale build. */
  it('says so when the check could not complete', () => {
    expect(describeUpdate(status({ phase: 'failed' }))).toBe(
      'Could not reach the update server',
    );
  });

  it('never leaves a version placeholder empty', () => {
    expect(describeUpdate(status({ phase: 'available' }))).toBe(
      'A new version is ready to install',
    );
  });
});
