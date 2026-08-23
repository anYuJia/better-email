import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';

afterEach(() => {
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
});
