import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PanelFooter } from '@/components/common/PanelFooter';
import { PanelHeader } from '@/components/common/PanelHeader';
import { PanelShell } from '@/components/common/PanelShell';

describe('PanelShell', () => {
  it('is the fixed 360x520 tray surface', () => {
    render(
      <PanelShell header={<div />} footer={<div />}>
        <div />
      </PanelShell>,
    );

    const shell = screen.getByTestId('panel-shell');

    expect(shell).toHaveClass('w-[360px]', 'h-[520px]');
  });

  /** The panel root carries `radius-2xl` and `e4` elevation plus the glass surface. */
  it('carries the panel elevation and glass surface', () => {
    render(
      <PanelShell header={<div />} footer={<div />}>
        <div />
      </PanelShell>,
    );

    const shell = screen.getByTestId('panel-shell');

    expect(shell).toHaveClass('rounded-2xl', 'shadow-e4', 'panel-glass');
  });

  /**
   * `backdrop-filter` belongs on the panel root and nowhere else — a nested blur layer costs
   * the 60 fps meter budget.
   */
  it('applies the glass surface to exactly one element', () => {
    const { container } = render(
      <PanelShell header={<div />} footer={<div />}>
        <div className="h-full" />
      </PanelShell>,
    );

    expect(container.querySelectorAll('.panel-glass')).toHaveLength(1);
  });

  it('renders header, content, and footer in order', () => {
    render(
      <PanelShell header={<div>the header</div>} footer={<div>the footer</div>}>
        <div>the content</div>
      </PanelShell>,
    );

    const shell = screen.getByTestId('panel-shell');

    expect(shell.textContent).toBe('the headerthe contentthe footer');
  });
});

describe('PanelHeader', () => {
  const noop = () => undefined;

  it('is the window drag region', () => {
    const { container } = render(
      <PanelHeader onSettingsOpen={noop} />,
    );

    expect(container.querySelector('header')).toHaveAttribute('data-tauri-drag-region');
  });

  /** Without opting out of the drag region, dragging swallows the buttons' clicks. */
  it('opts its icon buttons out of the drag region', () => {
    render(<PanelHeader onSettingsOpen={noop} />);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('data-tauri-drag-region', 'false');
    }
  });

  it('renders the audio badge chip with signal indicator', () => {
    render(<PanelHeader onSettingsOpen={noop} />);

    expect(screen.getByText('Audio')).toBeInTheDocument();
  });

  it('reports settings activation', async () => {
    const user = userEvent.setup();
    const handleSettingsOpen = vi.fn();

    render(<PanelHeader onSettingsOpen={handleSettingsOpen} />);

    await user.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(handleSettingsOpen).toHaveBeenCalledOnce();
  });
});

describe('PanelFooter', () => {
  it('renders app name and version badge', () => {
    render(<PanelFooter hotkey="CmdOrCtrl+Shift+V" version="1.0.0" />);
    expect(screen.getByText('Somul')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
  });

  /** The shortcut is one thing to press, so it reads as one chip joined by `+`. */
  it('renders the hotkey as a single chip', () => {
    const { container } = render(
      <PanelFooter hotkey="CmdOrCtrl+Shift+V" />,
    );

    const chips = [...container.querySelectorAll('kbd')];

    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toMatch(/^(⌘|Ctrl) \+ Shift \+ V$/);
  });
});
