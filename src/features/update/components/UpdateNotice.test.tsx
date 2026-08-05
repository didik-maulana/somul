import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { UpdateNotice } from '@/features/update/components/UpdateNotice';
import type { UpdateStatus } from '@/features/update/types';

const available: UpdateStatus = {
  phase: 'available',
  currentVersion: '1.0.0',
  availableVersion: '1.1.0',
  notes: 'Fixes the meter',
  downloadFraction: null,
};

const renderNotice = (status: UpdateStatus = available) => {
  const onInstall = vi.fn();
  const onRestart = vi.fn();
  const onShowNotes = vi.fn();
  const onDismiss = vi.fn();

  render(
    <UpdateNotice
      status={status}
      onInstall={onInstall}
      onRestart={onRestart}
      onShowNotes={onShowNotes}
      onDismiss={onDismiss}
    />,
  );

  return { onInstall, onRestart, onShowNotes, onDismiss, user: userEvent.setup() };
};

describe('UpdateNotice', () => {
  it('names the version on offer', () => {
    renderNotice();

    const notice = screen.getByTestId('update-notice');

    expect(notice).toHaveTextContent('Update available');
    expect(notice).toHaveTextContent('1.1.0');
  });

  it('installs on request', async () => {
    const { onInstall, user } = renderNotice();

    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(onInstall).toHaveBeenCalledOnce();
  });

  /** The changelog opens a window that outlives the panel dismissing itself. */
  it('hands the release notes to the window rather than opening them here', async () => {
    const { onShowNotes, user } = renderNotice();

    await user.click(screen.getByRole('button', { name: "What's new" }));

    expect(onShowNotes).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('release-notes')).not.toBeInTheDocument();
  });

  /** No disclosure at all rather than one that opens on nothing. */
  it('offers nothing to read when the manifest carried no notes', () => {
    renderNotice({ ...available, notes: null });

    expect(screen.queryByRole('button', { name: "What's new" })).not.toBeInTheDocument();
  });

  it('can be waved away', async () => {
    const { onDismiss, user } = renderNotice();

    await user.click(screen.getByRole('button', { name: 'Dismiss update notice' }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('announces itself without stealing focus', () => {
    renderNotice();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  describe('while downloading', () => {
    const installing: UpdateStatus = { ...available, phase: 'installing', downloadFraction: 0.42 };

    /** Pressing Update twice would start a second download over the running one. */
    it('withdraws its actions', () => {
      renderNotice(installing);

      expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Dismiss update notice' }),
      ).not.toBeInTheDocument();
    });

    it('fills the bar to how much has arrived', () => {
      renderNotice(installing);

      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
      expect(screen.getByTestId('update-progress')).toHaveStyle({ width: '42%' });
      expect(screen.getByText('42%')).toBeInTheDocument();
    });

    /** A server that sends no length leaves nothing to measure — but bytes are still moving. */
    it('falls back to an indeterminate bar when the download has no known size', () => {
      renderNotice({ ...installing, downloadFraction: null });

      expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
      expect(screen.getByTestId('update-progress')).not.toHaveStyle({ width: '0%' });
    });
  });

  describe('once installed', () => {
    const installed: UpdateStatus = { ...available, phase: 'installed' };

    it('offers the restart and a way to put it off', async () => {
      const { onRestart, onDismiss, user } = renderNotice(installed);

      expect(screen.getByTestId('update-notice')).toHaveTextContent('Update ready');

      await user.click(screen.getByRole('button', { name: 'Restart now' }));
      expect(onRestart).toHaveBeenCalledOnce();

      await user.click(screen.getByRole('button', { name: 'Later' }));
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    /** Installing again would re-download a build that is already on disk. */
    it('stops offering the install', () => {
      renderNotice(installed);

      expect(screen.queryByRole('button', { name: 'Update' })).not.toBeInTheDocument();
    });
  });
});
