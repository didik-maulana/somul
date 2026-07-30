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
      <PanelHeader isPinned={false} onPinToggle={noop} onSettingsOpen={noop} />,
    );

    expect(container.querySelector('header')).toHaveAttribute('data-tauri-drag-region');
  });

  /** Without opting out of the drag region, dragging swallows the buttons' clicks. */
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

    expect(screen.getByRole('button', { name: 'Show on all desktops' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    rerender(<PanelHeader isPinned onPinToggle={noop} onSettingsOpen={noop} />);

    expect(screen.getByRole('button', { name: 'Show on this desktop only' })).toHaveAttribute(
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

    await user.click(screen.getByRole('button', { name: 'Show on all desktops' }));
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

  /** The shortcut is one thing to press, so it reads as one chip joined by `+`. */
  it('renders the hotkey as a single chip', () => {
    const { container } = render(
      <PanelFooter activeSessionCount={0} hotkey="CmdOrCtrl+Shift+V" />,
    );

    const chips = [...container.querySelectorAll('kbd')];

    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toMatch(/^(⌘|Ctrl) \+ Shift \+ V$/);
  });
});
