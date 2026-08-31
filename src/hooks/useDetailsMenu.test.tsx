import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { useDetailsMenu } from './useDetailsMenu';

afterEach(() => {
  cleanup();
});

function MenuHarness({
  onCommand,
  floating = false,
}: {
  onCommand?: () => void;
  floating?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const menu = useDetailsMenu(ref, { floating });
  return (
    <div>
      <details ref={ref}>
        <summary>菜单</summary>
        <div data-floating-menu-panel="true">
          <button type="button" onClick={() => { onCommand?.(); menu.closeMenu(); }}>命令A</button>
          <button type="button">命令B</button>
        </div>
      </details>
      <button type="button">外部按钮</button>
    </div>
  );
}

function openDetails() {
  const summary = document.querySelector('summary') as HTMLElement;
  const details = document.querySelector('details') as HTMLElement;
  fireEvent.click(summary);
  details.setAttribute('open', '');
  return { summary, details };
}

describe('useDetailsMenu', () => {
  it('closes a single-command menu after the command is selected', () => {
    const onCommand = vi.fn();
    render(<MenuHarness onCommand={onCommand} />);
    const { details } = openDetails();
    expect(details.hasAttribute('open')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '命令A' }));
    expect(onCommand).toHaveBeenCalled();
    expect(details.hasAttribute('open')).toBe(false);
  });

  it('closes on outside pointerdown and restores summary focus', () => {
    render(<MenuHarness />);
    const { summary, details } = openDetails();
    expect(details.hasAttribute('open')).toBe(true);

    fireEvent.pointerDown(screen.getByRole('button', { name: '外部按钮' }));
    expect(details.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('closes on Escape from within the menu', () => {
    render(<MenuHarness />);
    const { details } = openDetails();
    const command = screen.getByRole('button', { name: '命令B' });
    command.focus();
    fireEvent.keyDown(command, { key: 'Escape' });
    expect(details.hasAttribute('open')).toBe(false);
  });

  it('does not close when Escape fires outside the menu', () => {
    render(<MenuHarness />);
    const { details } = openDetails();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(details.hasAttribute('open')).toBe(true);
  });

  it('contains wheel gestures when the menu has no remaining scroll range', () => {
    render(<MenuHarness />);
    openDetails();
    const panel = screen.getByRole('button', { name: '命令A' }).parentElement as HTMLElement;
    const outsideWheel = vi.fn();
    document.body.addEventListener('wheel', outsideWheel);

    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 80,
    });
    panel.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(outsideWheel).not.toHaveBeenCalled();
    document.body.removeEventListener('wheel', outsideWheel);
  });

  it('lets the menu scroll internally without bubbling the gesture outside', () => {
    render(<MenuHarness />);
    openDetails();
    const panel = screen.getByRole('button', { name: '命令A' }).parentElement as HTMLElement;
    Object.defineProperties(panel, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 240 },
      scrollTop: { configurable: true, value: 20, writable: true },
    });
    const outsideWheel = vi.fn();
    document.body.addEventListener('wheel', outsideWheel);

    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 80,
    });
    panel.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(false);
    expect(outsideWheel).not.toHaveBeenCalled();
    document.body.removeEventListener('wheel', outsideWheel);
  });

  it('promotes floating panels to the browser top layer and hides them on close', async () => {
    const { rerender } = render(<MenuHarness floating />);
    const panel = screen.getByRole('button', { name: '命令A' }).parentElement as HTMLElement & {
      showPopover?: () => void;
      hidePopover?: () => void;
    };
    let popoverOpen = false;
    const showPopover = vi.fn(() => { popoverOpen = true; });
    const hidePopover = vi.fn(() => { popoverOpen = false; });
    Object.defineProperties(panel, {
      showPopover: { configurable: true, value: showPopover },
      hidePopover: { configurable: true, value: hidePopover },
    });
    const nativeMatches = panel.matches.bind(panel);
    vi.spyOn(panel, 'matches').mockImplementation((selector) => (
      selector === ':popover-open' ? popoverOpen : nativeMatches(selector)
    ));

    const { details } = openDetails();
    fireEvent(details, new Event('toggle'));

    await waitFor(() => expect(showPopover).toHaveBeenCalledTimes(1));
    expect(panel.getAttribute('popover')).toBe('manual');

    rerender(<MenuHarness floating />);
    await waitFor(() => expect(details.hasAttribute('open')).toBe(true));
    expect(showPopover).toHaveBeenCalledTimes(1);
    expect(hidePopover).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole('button', { name: '外部按钮' }));
    expect(hidePopover).toHaveBeenCalledTimes(1);
    expect(details.hasAttribute('open')).toBe(false);
  });
});
