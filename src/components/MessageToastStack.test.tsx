import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessageToastStack from './MessageToastStack';
import type { PendingSendUndo } from './UndoSnackbarStack';

const NOW = new Date('2026-08-20T02:00:00.000Z');

function pendingUndo(): PendingSendUndo {
  return {
    outboxId: 42,
    subject: '季度计划',
    expiresAt: new Date(NOW.getTime() + 10_000).toISOString(),
    delaySeconds: 10,
  };
}

describe('MessageToastStack announcements and exit state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the visual countdown out of the live region and announces send undo once', () => {
    render(
      <MessageToastStack
        toasts={[]}
        pendingSendUndo={pendingUndo()}
        onUndoSend={() => undefined}
        onDismissSend={() => undefined}
      />,
    );

    const announcement = screen.getByRole('status');
    const initialAnnouncement = announcement.textContent;
    expect(initialAnnouncement).toBe('邮件将在 10 秒后发送。主题：季度计划。可选择撤回发送。');
    expect(document.querySelector('.message-toast-stack')?.getAttribute('aria-live')).toBe('off');
    expect(document.querySelector('.message-toast-count')?.textContent).toBe('10');

    act(() => {
      vi.advanceTimersByTime(1_250);
    });

    expect(document.querySelector('.message-toast-count')?.textContent).toBe('9');
    expect(screen.getByRole('status')).toBe(announcement);
    expect(announcement.textContent).toBe(initialAnnouncement);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('announces each routine toast in a hidden live region', () => {
    render(
      <MessageToastStack
        toasts={[
          { id: 1, text: '邮件已归档' },
          { id: 2, text: '标签已更新' },
        ]}
        pendingSendUndo={null}
        onUndoSend={() => undefined}
        onDismissSend={() => undefined}
      />,
    );

    expect(screen.getAllByRole('status').map((status) => status.textContent)).toEqual([
      '邮件已归档',
      '标签已更新',
    ]);
    expect(document.querySelector('.message-toast-stack')?.hasAttribute('role')).toBe(false);
  });

  it('announces errors assertively and renders a severity-aware visual toast', () => {
    render(
      <MessageToastStack
        toasts={[{ id: 3, text: '同步失败，请重试', tone: 'error' }]}
        pendingSendUndo={null}
        onUndoSend={() => undefined}
        onDismissSend={() => undefined}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('同步失败，请重试');
    expect(document.querySelector('.message-toast.toast-error')).not.toBeNull();
  });

  it('moves removed toasts into effect-driven exit state before unmounting them', () => {
    const { rerender } = render(
      <MessageToastStack
        toasts={[{ id: 1, text: '邮件已归档' }]}
        pendingSendUndo={null}
        onUndoSend={() => undefined}
        onDismissSend={() => undefined}
      />,
    );

    rerender(
      <MessageToastStack
        toasts={[]}
        pendingSendUndo={null}
        onUndoSend={() => undefined}
        onDismissSend={() => undefined}
      />,
    );

    expect(document.querySelector('.message-toast.leaving')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(document.querySelector('.message-toast')).toBeNull();
  });

  it('preserves the send-undo exit animation without retaining its live announcement', () => {
    const { rerender } = render(
      <MessageToastStack
        toasts={[]}
        pendingSendUndo={pendingUndo()}
        onUndoSend={() => undefined}
        onDismissSend={() => undefined}
      />,
    );

    rerender(
      <MessageToastStack
        toasts={[]}
        pendingSendUndo={null}
        onUndoSend={() => undefined}
        onDismissSend={() => undefined}
      />,
    );

    expect(document.querySelector('.message-toast-undo.leaving')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: '撤回发送' })).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('.message-toast-undo-btn')?.disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(document.querySelector('.message-toast-undo')).toBeNull();
  });

  it('merges matching results without remounting the announcement when their ids change', () => {
    const props = { pendingSendUndo: null, onUndoSend: vi.fn(), onDismissSend: vi.fn() };
    const view = render(<MessageToastStack {...props} toasts={[
      { id: 1, text: '邮件已归档' }, { id: 2, text: '邮件已归档' },
    ]} />);
    const announcement = screen.getByRole('status');
    expect(document.querySelectorAll('.message-toast')).toHaveLength(1);
    expect(screen.getByLabelText('重复 2 次').textContent).toBe('×2');
    view.rerender(<MessageToastStack {...props} toasts={[
      { id: 2, text: '邮件已归档' }, { id: 3, text: '邮件已归档' },
    ]} />);
    expect(screen.getByRole('status')).toBe(announcement);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    view.rerender(<MessageToastStack {...props} toasts={[
      { id: 2, text: '邮件已归档' }, { id: 3, text: '邮件已归档', tone: 'error' },
    ]} />);
    expect(screen.getByRole('alert').textContent).toBe('邮件已归档');
    expect(document.querySelectorAll('.message-toast')).toHaveLength(2);
  });

  it('caps active and leaving messages together and reserves an accessible undo slot', () => {
    const onUndoSend = vi.fn();
    const props = { pendingSendUndo: pendingUndo(), onUndoSend, onDismissSend: vi.fn() };
    const messages = Array.from({ length: 8 }, (_, id) => ({ id, text: `结果 ${id}` }));
    const view = render(<MessageToastStack {...props} toasts={messages} />);
    expect(document.querySelectorAll('.message-toast')).toHaveLength(3);
    expect(Array.from(document.querySelectorAll('.message-toast-text')).map(node => node.textContent))
      .toEqual(['结果 6', '结果 7']);
    const undo = screen.getByRole('button', { name: '撤回发送' });
    undo.focus();
    fireEvent.click(undo);
    expect(onUndoSend).toHaveBeenCalledTimes(1);
    view.rerender(<MessageToastStack {...props} toasts={[{ id: 9, text: '最新结果' }]} />);
    expect(document.querySelectorAll('.message-toast')).toHaveLength(3);
    expect(document.querySelectorAll('.message-toast.leaving')).toHaveLength(1);
    expect(document.activeElement).toBe(undo);
  });

  it('uses two slots in a short window and restores focus when its scrollable region unmounts', () => {
    const messages = Array.from({ length: 5 }, (_, id) => ({ id, text: `结果 ${id}` }));
    const outside = document.createElement('button');
    outside.textContent = '邮件操作'; document.body.append(outside);
    const view = render(<MessageToastStack toasts={messages} pendingSendUndo={pendingUndo()}
      onUndoSend={vi.fn()} onDismissSend={vi.fn()} />);
    vi.stubGlobal('innerHeight', 320);
    fireEvent(window, new Event('resize'));
    expect(document.querySelectorAll('.message-toast')).toHaveLength(2);
    outside.focus();
    act(() => screen.getByRole('region', { name: '最近通知' }).focus());
    view.unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
