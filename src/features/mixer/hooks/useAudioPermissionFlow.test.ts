import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAudioPermissionFlow } from '@/features/mixer/hooks/useAudioPermissionFlow';
import type { PlatformCapabilities } from '@/types/ipc';

const { openSettingsSpy, relaunchSpy } = vi.hoisted(() => ({
  openSettingsSpy: vi.fn(() => Promise.resolve()),
  relaunchSpy: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/ipc', () => ({
  openAudioPermissionSettings: openSettingsSpy,
  relaunchApp: relaunchSpy,
}));

const capable: PlatformCapabilities = {
  hasPerAppVolume: true,
  hasPerAppMute: true,
  hasPerAppMeter: true,
  hasPerAppRouting: false,
  unsupportedReason: null,
  needsAudioPermission: false,
  hasExhaustedCaptureRetries: false,
};

const withheld: PlatformCapabilities = {
  ...capable,
  unsupportedReason: 'Somul has not heard any app audio yet.',
  needsAudioPermission: true,
};

const exhausted: PlatformCapabilities = { ...withheld, hasExhaustedCaptureRetries: true };

beforeEach(() => {
  openSettingsSpy.mockClear();
  relaunchSpy.mockClear();
});

describe('useAudioPermissionFlow', () => {
  it('asks for nothing until the permission is actually withheld', () => {
    const { result } = renderHook(() => useAudioPermissionFlow(capable));

    expect(result.current.phase).toBe('unrequested');
  });

  it('stays unrequested while the user has not been sent to System Settings', () => {
    const { result } = renderHook(() => useAudioPermissionFlow(exhausted));

    expect(result.current.phase).toBe('unrequested');
  });

  it('waits before blaming the process, so a grant in flight is given its chance', () => {
    const { result } = renderHook(() => useAudioPermissionFlow(withheld));

    act(() => {
      result.current.openSettings();
    });

    expect(openSettingsSpy).toHaveBeenCalledOnce();
    expect(result.current.phase).toBe('awaiting');
  });

  it('offers the relaunch once the backend has stopped getting a new answer', () => {
    const { rerender, result } = renderHook(
      ({ capabilities }) => useAudioPermissionFlow(capabilities),
      { initialProps: { capabilities: withheld } },
    );

    act(() => {
      result.current.openSettings();
    });
    rerender({ capabilities: exhausted });

    expect(result.current.phase).toBe('relaunchRequired');

    act(() => {
      result.current.relaunch();
    });

    expect(relaunchSpy).toHaveBeenCalledOnce();
  });

  /**
   * The permission can be taken away again in the same run, and the second notice has to start
   * where the first one did — a user who has not been to System Settings this time is not waiting
   * on anything, and telling them to relaunch would send them somewhere that fixes nothing.
   */
  it('starts over when the permission is granted and then revoked', () => {
    const { rerender, result } = renderHook(
      ({ capabilities }) => useAudioPermissionFlow(capabilities),
      { initialProps: { capabilities: withheld } },
    );

    act(() => {
      result.current.openSettings();
    });
    rerender({ capabilities: capable });
    rerender({ capabilities: exhausted });

    expect(result.current.phase).toBe('unrequested');
  });

  it('reports nothing while capabilities are still unknown', () => {
    const { result } = renderHook(() => useAudioPermissionFlow(null));

    expect(result.current.phase).toBe('unrequested');
  });
});
