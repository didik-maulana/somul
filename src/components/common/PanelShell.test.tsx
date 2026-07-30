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

  /** DESIGN.md §9.1: `radius-2xl` and `e4` + `panel-glass`. */
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
   * DESIGN.md §6: `backdrop-filter` belongs on the panel root and nowhere else. A nested blur
   * layer costs the 60 fps meter budget.
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
      <PanelHeader isPinned={false} onPinToggle={noop} onSettingsOpen={noop} />,
    );

    expect(container.querySelector('header')).toHaveAttribute('data-tauri-drag-region');
  });

  /** DESIGN.md §9.2: without opting out, dragging swallows the buttons' clicks. */
  it('opts its icon buttons out of the drag region', () => {
    render(<PanelHeader isPinned={false} onPinToggle={noop} onSettingsOpen={noop} />);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('data-tauri-drag-region', 'false');
    }
  });

  it('names the pin control by the action it will take', () => {
    const { rerender } = render(
      <PanelHeader isPinned={false} onPinToggle={noop} onSettingsOpen={noop} />,
    );

    expect(screen.getByRole('button', { name: 'Pin panel open' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    rerender(<PanelHeader isPinned onPinToggle={noop} onSettingsOpen={noop} />);

    expect(screen.getByRole('button', { name: 'Unpin panel' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reports pin and settings activation', async () => {
    const user = userEvent.setup();
    const handlePinToggle = vi.fn();
    const handleSettingsOpen = vi.fn();

    render(
      <PanelHeader
        isPinned={false}
        onPinToggle={handlePinToggle}
        onSettingsOpen={handleSettingsOpen}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pin panel open' }));
    await user.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(handlePinToggle).toHaveBeenCalledOnce();
    expect(handleSettingsOpen).toHaveBeenCalledOnce();
  });
});

describe('PanelFooter', () => {
  it('reports the active session count', () => {
    const { rerender } = render(<PanelFooter activeSessionCount={3} hotkey="CmdOrCtrl+Shift+V" />);
    expect(screen.getByText('3 apps')).toBeInTheDocument();

    rerender(<PanelFooter activeSessionCount={1} hotkey="CmdOrCtrl+Shift+V" />);
    expect(screen.getByText('1 app')).toBeInTheDocument();
  });

  /** DESIGN.md §9.10: the hotkey renders as `<kbd>` chips, one per key. */
  it('renders the hotkey as one chip per key', () => {
    const { container } = render(
      <PanelFooter activeSessionCount={0} hotkey="CmdOrCtrl+Shift+V" />,
    );

    const keys = [...container.querySelectorAll('kbd')].map((chip) => chip.textContent);

    expect(keys).toEqual(['CmdOrCtrl', 'Shift', 'V']);
  });
});
