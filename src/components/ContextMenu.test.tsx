import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

const items: ContextMenuItem[] = [
  { id: 'open', label: '打开' },
  { id: 'delete', label: '删除', danger: true },
];

function MenuHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>触发按钮</button>
      {open && (
        <ContextMenu x={10} y={10} items={items} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

describe('ContextMenu focus management', () => {
  it('moves focus into the menu under React StrictMode', () => {
    render(
      <StrictMode>
        <MenuHarness />
      </StrictMode>,
    );
    const trigger = screen.getByRole('button', { name: '触发按钮' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '打开' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the trigger button on Escape close', () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '触发按钮' });
    trigger.focus();
    fireEvent.click(trigger);
    // 菜单打开后聚焦第一个菜单项。
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '打开' }));

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the trigger button on outside click close', () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '触发按钮' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the trigger button after selecting a menu item', () => {
    const onSelect = vi.fn();
    const itemsWithAction = [
      { id: 'open', label: '打开', onSelect },
    ] as ContextMenuItem[];
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>触发按钮</button>
          {open && (
            <ContextMenu x={10} y={10} items={itemsWithAction} onClose={() => setOpen(false)} />
          )}
        </div>
      );
    };
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '触发按钮' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '打开' }));
    expect(onSelect).toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not yank focus back to the trigger when Tab closes the menu', () => {
    render(
      <div>
        <MenuHarness />
        <input aria-label="下一个元素" />
      </div>,
    );
    const trigger = screen.getByRole('button', { name: '触发按钮' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeDefined();

    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    // Tab 关闭时不应把焦点拉回触发元素（jsdom 无法真正执行 Tab 导航）。
    expect(document.activeElement).not.toBe(trigger);
  });

  it('degrades safely when the trigger element was removed', () => {
    const { unmount } = render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '触发按钮' });
    trigger.focus();
    fireEvent.click(trigger);
    // 直接卸载整个树（触发按钮与菜单一起消失），不应抛错。
    unmount();
  });

  it('stays open while its own scroll surface moves', () => {
    render(<MenuHarness />);
    fireEvent.click(screen.getByRole('button', { name: '触发按钮' }));
    const menu = screen.getByRole('menu');

    fireEvent.scroll(menu);

    expect(screen.getByRole('menu')).toBeDefined();
  });

  it('contains wheel gestures instead of scrolling the surface behind it', () => {
    render(<MenuHarness />);
    fireEvent.click(screen.getByRole('button', { name: '触发按钮' }));
    const menu = screen.getByRole('menu').closest('.context-menu') as HTMLElement;
    const outsideWheel = vi.fn();
    document.body.addEventListener('wheel', outsideWheel);

    const wheel = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 80,
    });
    menu.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(outsideWheel).not.toHaveBeenCalled();
    document.body.removeEventListener('wheel', outsideWheel);
  });

  it('keeps a submenu open while the pointer crosses the gap into it', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[{
          id: 'move',
          label: '移动到',
          children: [{ id: 'archive', label: '归档', onSelect }],
        }]}
        onClose={vi.fn()}
      />,
    );
    const branch = screen.getByRole('menuitem', { name: '移动到' }).parentElement as HTMLElement;

    fireEvent.pointerEnter(branch);
    expect(branch.classList.contains('is-pointer-open')).toBe(true);
    fireEvent.pointerLeave(branch);
    vi.advanceTimersByTime(120);
    fireEvent.pointerEnter(branch);
    vi.advanceTimersByTime(300);

    expect(branch.classList.contains('is-pointer-open')).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: '归档' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps a submenu open when its parent item is clicked', () => {
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[{
          id: 'labels',
          label: '标签',
          children: [{ id: 'work', label: '工作' }],
        }]}
        onClose={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('menuitem', { name: '标签' });
    const branch = trigger.parentElement as HTMLElement;

    fireEvent.click(trigger);
    expect(branch.classList.contains('is-pointer-open')).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBeTruthy();
    fireEvent.click(trigger);
    expect(branch.classList.contains('is-pointer-open')).toBe(true);
  });

  it('waits for an explicit tap before expanding an inline mobile submenu', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 720px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[{
          id: 'labels',
          label: '标签',
          children: [{ id: 'work', label: '工作' }],
        }]}
        onClose={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('menuitem', { name: '标签' });
    const branch = trigger.parentElement as HTMLElement;

    fireEvent.pointerEnter(branch);
    expect(branch.classList.contains('is-pointer-open')).toBe(false);

    fireEvent.click(trigger);
    expect(branch.classList.contains('is-pointer-open')).toBe(true);
  });
});
