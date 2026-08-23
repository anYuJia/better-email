import { act, cleanup, render, screen } from '@testing-library/react';
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

    act(() => {
      vi.advanceTimersByTime(260);
    });

    expect(document.querySelector('.message-toast-undo')).toBeNull();
  });
});
