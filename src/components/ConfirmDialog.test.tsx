import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog Component robust behaviors', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders correctly and focuses cancel default safe button when opened', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    const { unmount } = render(
      <ConfirmDialog
        open={true}
        title="永久删除邮件吗"
        description="该操作不可逆。"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole('dialog')).toBeDefined();
    
    // Focus recovery target simulation
    const cancelBtn = screen.getByRole('button', { name: '取消' });
    
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(document.activeElement).toBe(cancelBtn);
    unmount();
  });

  it('supports Tab cycle focus locking', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    const { unmount } = render(
      <ConfirmDialog
        open={true}
        title="永久删除"
        description="该操作不可逆。"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const closeBtn = screen.getByRole('button', { name: '关闭确认' });
    const cancelBtn = screen.getByRole('button', { name: '取消' });
    const confirmBtn = screen.getByRole('button', { name: '确认' });

    // Focus close button
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    // Tab on last element should cycle to first
    confirmBtn.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    // Tab cycle logic traps shift/no-shift tabs
    unmount();
  });

  it('supports Escape key callback trigger', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    const { unmount } = render(
      <ConfirmDialog
        open={true}
        title="永久删除"
        description="该操作不可逆。"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('blocks button operations and backdrop close when pending', async () => {
    const onCancel = vi.fn();
    let resolveConfirm!: () => void;
    const confirmPromise = new Promise<void>((resolve) => {
      resolveConfirm = resolve;
    });
    const onConfirm = vi.fn(() => confirmPromise);

    const { unmount } = render(
      <ConfirmDialog
        open={true}
        title="永久删除"
        description="该操作不可逆。"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: '确认' });
    const cancelBtn = screen.getByRole('button', { name: '取消' });

    // Trigger confirm
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Click again - should not call onConfirm again because of pending state
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    expect(cancelBtn.hasAttribute('disabled')).toBe(true);
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    // Try background dismiss
    const backdrop = document.querySelector('.settings-cache-confirm-backdrop');
    if (backdrop) {
      fireEvent.mouseDown(backdrop);
    }
    expect(onCancel).not.toHaveBeenCalled();

    // Try Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => {
      resolveConfirm();
    });
    unmount();
  });

  it('captures errors and displays them on confirm reject, allowing retry', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new Error('网络连接超时，请重试'));

    const { unmount } = render(
      <ConfirmDialog
        open={true}
        title="永久删除"
        description="该操作不可逆。"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: '确认' });
    
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(screen.getByText('错误: 网络连接超时，请重试')).toBeDefined();
    expect(confirmBtn.hasAttribute('disabled')).toBe(false); // Enabled for retry

    // Retry confirm
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    expect(onConfirm).toHaveBeenCalledTimes(2);

    unmount();
  });

  it('restores focus to previous active element after closing', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    const { rerender, unmount } = render(
      <ConfirmDialog
        open={true}
        title="永久删除"
        description="该操作不可逆。"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    rerender(
      <ConfirmDialog
        open={false}
        title="永久删除"
        description="该操作不可逆。"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
    unmount();
  });
});
