import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateWindow } from '@/features/update/components/UpdateWindow';

const LONG_NOTES = [
  'Somul 1.1.0.',
  '',
  '## Mixer',
  '- Per-app rows keep their volume across launches',
  '- A row no longer claims a slider it cannot move,',
  '  which is what left empty rows behind',
  '',
  '## Fixes',
  '- The tray opens one panel, not two',
].join('\n');

const { getUpdateStateSpy, installUpdateSpy, relaunchAppSpy, checkForUpdateSpy } = vi.hoisted(
  () => ({
    getUpdateStateSpy: vi.fn(),
    installUpdateSpy: vi.fn(),
    relaunchAppSpy: vi.fn(),
    checkForUpdateSpy: vi.fn(),
  }),
);

vi.mock('@/lib/ipc', () => ({
  getUpdateState: getUpdateStateSpy,
  checkForUpdate: checkForUpdateSpy,
  installUpdate: installUpdateSpy,
  relaunchApp: relaunchAppSpy,
  openUpdateWindow: () => Promise.resolve(),
  onUpdateChanged: () => Promise.resolve(() => undefined),
  onUpdateProgress: () => Promise.resolve(() => undefined),
}));

const available = {
  phase: 'available' as const,
  currentVersion: '1.0.0',
  availableVersion: '1.1.0',
  notes: LONG_NOTES,
};

beforeEach(() => {
  getUpdateStateSpy.mockReset().mockResolvedValue(available);
  checkForUpdateSpy.mockReset().mockResolvedValue(available);
  installUpdateSpy.mockReset().mockResolvedValue(undefined);
  relaunchAppSpy.mockReset().mockResolvedValue(undefined);
});

describe('UpdateWindow', () => {
  it('opens on what the backend already knows, without checking again first', async () => {
    render(<UpdateWindow />);

    await waitFor(() => {
      expect(screen.getByText('1.1.0')).toBeInTheDocument();
    });

    expect(getUpdateStateSpy).toHaveBeenCalled();
  });

  it('lays the changelog out by shape', async () => {
    render(<UpdateWindow />);

    await waitFor(() => {
      expect(screen.getByTestId('release-notes')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'Mixer' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fixes' })).toBeInTheDocument();
    expect(
      screen.getByText('A row no longer claims a slider it cannot move, which is what left empty rows behind'),
    ).toBeInTheDocument();
  });

  it('installs from the window', async () => {
    const user = userEvent.setup();

    render(<UpdateWindow />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Install update' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Install update' }));

    expect(installUpdateSpy).toHaveBeenCalledOnce();
  });

  /** However long the notes run, the decision the window exists for stays reachable. */
  it('keeps the action out of the scrolling region', async () => {
    render(<UpdateWindow />);

    const action = await screen.findByRole('button', { name: 'Install update' });
    const notes = screen.getByTestId('release-notes');

    expect(notes.contains(action)).toBe(false);
  });

  it('offers the restart once the build is on disk', async () => {
    getUpdateStateSpy.mockResolvedValue({ ...available, phase: 'installed' });

    const user = userEvent.setup();

    render(<UpdateWindow />);

    const restart = await screen.findByRole('button', { name: 'Restart now' });

    expect(screen.getByRole('heading', { name: 'Update installed' })).toBeInTheDocument();

    await user.click(restart);

    expect(relaunchAppSpy).toHaveBeenCalledOnce();
  });

  it('says so plainly when there is nothing to install', async () => {
    getUpdateStateSpy.mockResolvedValue({
      phase: 'upToDate',
      currentVersion: '1.0.0',
      availableVersion: null,
      notes: null,
    });

    render(<UpdateWindow />);

    await waitFor(() => {
      expect(screen.getByText('Somul is up to date.')).toBeInTheDocument();
    });

    expect(screen.getByText('This release was published without notes.')).toBeInTheDocument();
  });
});
