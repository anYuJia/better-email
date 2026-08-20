import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import ShortcutHelpModal from './ShortcutHelpModal';

afterEach(cleanup);

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" id="trigger" onClick={() => setOpen(true)}>打开帮助</button>
      <ShortcutHelpModal
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
      />
    </div>
  );
}

function closeButton() {
  return document.querySelector('.shortcut-modal header button') as HTMLButtonElement;
}

function trigger() {
  return document.getElementById('trigger') as HTMLButtonElement;
}

describe('ShortcutHelpModal 键盘可达性', () => {
  it('打开时保存原焦点并把焦点移到弹窗内可操作元素，关闭后恢复焦点', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    trigger().focus();
    expect(document.activeElement).toBe(trigger());

    // 打开弹窗：焦点移入弹窗内可操作元素（关闭按钮）。
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(closeButton());
    expect(trigger().hasAttribute('inert')).toBe(true);
    expect(trigger().getAttribute('aria-hidden')).toBe('true');

    // 关闭弹窗：焦点恢复到打开前的触发按钮。
    fireEvent.click(closeButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.shortcut-modal')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger().hasAttribute('inert')).toBe(false);
    expect(trigger().hasAttribute('aria-hidden')).toBe(false);
  });

  it('Tab / Shift+Tab 在弹窗内循环（焦点不逃逸到弹窗外）', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(trigger());

    // 唯一可操作元素（关闭按钮）已聚焦；Tab 应被拦截并保持在弹窗内。
    expect(document.activeElement).toBe(closeButton());
    const tabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    const tabPreventDefault = vi.spyOn(tabEvent, 'preventDefault');
    document.dispatchEvent(tabEvent);
    expect(tabPreventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(closeButton());

    const shiftTabEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    const shiftTabPreventDefault = vi.spyOn(shiftTabEvent, 'preventDefault');
    document.dispatchEvent(shiftTabEvent);
    expect(shiftTabPreventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(closeButton());
  });

  it('Escape 关闭弹窗', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(trigger());
    expect(document.querySelector('.shortcut-modal')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.shortcut-modal')).toBeNull();
  });

  it('遮罩点击关闭保留', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(trigger());

    const backdrop = document.querySelector('.shortcut-backdrop') as HTMLElement;
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.shortcut-modal')).toBeNull();
  });
});
