import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MessageSummary, ThreadSummary } from '../app/types';
import MessageListPane, { type MessageListPaneProps } from './MessageListPane';

vi.mock('./MessageListView', () => ({ default: () => <div>邮件列表</div> }));
afterEach(cleanup);

const message: MessageSummary = {
  id: 1, account_id: 1, account_email: 'demo@example.com', folder_id: 1, folder_role: 'inbox',
  sender_name: 'Team', sender_email: 'team@example.com', recipients: 'demo@example.com', cc: '', bcc: '',
  subject: 'Update', snippet: 'Update', security_warnings: [], received_at: '2026-08-20T08:00:00Z',
  is_read: false, is_starred: false, has_attachments: false, snoozed_until: '', labels: [],
  attachment_count: 0, remote_mailbox: 'INBOX', remote_uid: 1,
};
const threads: ThreadSummary[] = [1, 2].map(id => ({
  thread_key: `thread-${id}`, subject: `Thread ${id}`, message_count: 1, unread_count: 0,
  latest_at: '2026-08-20T08:00:00Z', latest_preview: 'Preview', participants: 'team@example.com', is_muted: false,
}));
function deferred() {
  let resolve!: (messages: MessageSummary[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<MessageSummary[]>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function props(): MessageListPaneProps {
  return {
    mobile: true, appliedQuery: '', filter: 'all', listMode: 'threads', listSort: 'newest',
    selectedMessageIds: [], selectedMessages: [], folders: [], labels: [], threads, activeThread: null,
    messages: [message], selectedId: 1, hasMoreMessages: false, currentViewLabel: '收件箱',
    visibleListSummary: '1 封', messageListSummary: '1 封', listStateKey: 'view-a', initialScrollTop: 0,
    onScrollTopChange: vi.fn(), onClearSearchAndFilter: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined),
    onShowMessages: vi.fn(), onShowThreads: vi.fn(), onFilterChange: vi.fn(), onSortChange: vi.fn(),
    onToggleAllVisible: vi.fn(), onRunBulkAction: vi.fn(), onRequestSnooze: vi.fn(), onMoveBulkToFolder: vi.fn(),
    onToggleBulkLabel: vi.fn(), onRunMessageAction: vi.fn(), onMoveMessageToFolder: vi.fn(),
    onToggleMessageLabel: vi.fn(), onComposeFromMessage: vi.fn(), onOpenThread: vi.fn().mockResolvedValue([message]),
    onLoadThreadMessages: vi.fn().mockResolvedValue([message]), onRunThreadAction: vi.fn(),
    onMoveThreadToFolder: vi.fn(), onToggleThreadLabel: vi.fn(), onToggleThreadMute: vi.fn(),
    onSelectMessage: vi.fn(), onToggleMessageSelection: vi.fn(), onLoadMore: vi.fn().mockResolvedValue([]),
  };
}
function openMenu(index = 0) {
  const card = document.querySelectorAll<HTMLElement>('.thread-card')[index];
  card.focus();
  fireEvent.contextMenu(card, { clientX: 80, clientY: 120 });
}
async function settle(request: ReturnType<typeof deferred>, result = [message]) {
  await act(async () => { request.resolve(result); await request.promise; });
}

describe('thread menu request ownership', () => {
  it('uses the read-only membership loader for desktop menus without navigating the reader', async () => {
    const request = deferred();
    const input = { ...props(), mobile: false, onLoadThreadMessages: vi.fn(() => request.promise) };
    render(<MessageListPane {...input} />);
    openMenu(1);
    expect(input.onLoadThreadMessages).toHaveBeenCalledWith(threads[1]);
    expect(input.onOpenThread).not.toHaveBeenCalled();
    await settle(request);
    expect(screen.getByRole('menu', { name: '会话操作' })).toBeDefined();
    expect(input.onOpenThread).not.toHaveBeenCalled();
  });
  it('discards an old read after loading a new mailbox, without stealing focus', async () => {
    const request = deferred();
    const initial = { ...props(), onLoadThreadMessages: vi.fn(() => request.promise) };
    const view = render(<MessageListPane {...initial} />);
    openMenu();
    view.rerender(<MessageListPane {...initial} mailboxUnavailable mailboxPending />);
    view.rerender(<MessageListPane {...initial} listStateKey="view-b" />);
    const target = document.querySelector<HTMLElement>('.thread-card')!;
    target.focus();
    await settle(request);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(target);
  });

  it('invalidates a pending read even when the new key commits without a loading frame', async () => {
    const request = deferred();
    const initial = { ...props(), onLoadThreadMessages: vi.fn(() => request.promise) };
    const view = render(<MessageListPane {...initial} />);
    openMenu();
    view.rerender(<MessageListPane {...initial} listStateKey="view-b" />);
    await settle(request);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the newer menu when an older request fails later', async () => {
    const first = deferred(), second = deferred();
    const initial = { ...props(), onLoadThreadMessages: vi.fn()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) };
    render(<MessageListPane {...initial} />);
    openMenu(0); openMenu(1);
    await settle(second, [{ ...message, id: 2 }]);
    expect(screen.getByRole('menu', { name: '会话操作' }).closest('.context-menu-surface')?.textContent).toContain('Thread 2');
    await act(async () => { first.reject(new Error('obsolete failure')); await first.promise.catch(() => undefined); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('menu', { name: '会话操作' }).closest('.context-menu-surface')?.textContent).toContain('Thread 2');
    fireEvent.click(screen.getByRole('menuitem', { name: '静音会话' }));
    expect(initial.onToggleThreadMute).toHaveBeenCalledWith(threads[1], [{ ...message, id: 2 }]);
  });

  it.each(['Escape', 'pointer', 'open-thread'] as const)('cancels a pending menu on %s', async action => {
    const request = deferred();
    const initial = { ...props(), onLoadThreadMessages: vi.fn(() => request.promise) };
    render(<MessageListPane {...initial} />);
    openMenu();
    if (action === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    if (action === 'pointer') fireEvent.pointerDown(document.body);
    if (action === 'open-thread') fireEvent.click(document.querySelector('.thread-card')!);
    await settle(request);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not treat IME Escape as cancellation and closes the resulting menu normally', async () => {
    const request = deferred();
    render(<MessageListPane {...props()} onLoadThreadMessages={() => request.promise} />);
    openMenu();
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    await settle(request);
    expect(screen.getByRole('menu', { name: '会话操作' })).toBeDefined();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('reports a current failure and lets the user reopen successfully', async () => {
    const request = deferred();
    render(<MessageListPane {...props()} onLoadThreadMessages={vi.fn()
      .mockReturnValueOnce(request.promise).mockResolvedValueOnce([message])} />);
    openMenu();
    await act(async () => { request.reject(new Error('read failed')); await request.promise.catch(() => undefined); });
    expect(screen.getByRole('alert').textContent).toContain('重新打开操作菜单');
    expect(screen.queryByRole('menu')).toBeNull();
    await act(async () => { openMenu(); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('menu', { name: '会话操作' })).toBeDefined();
  });

  it('does not offer mutation actions for an empty thread response', async () => {
    render(<MessageListPane {...props()} onLoadThreadMessages={vi.fn().mockResolvedValue([])} />);
    await act(async () => { openMenu(); });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('没有可操作的邮件');
  });

  it('ignores a late read after switching presentation or unmounting', async () => {
    const request = deferred();
    const initial = { ...props(), onLoadThreadMessages: vi.fn(() => request.promise) };
    const view = render(<MessageListPane {...initial} />);
    openMenu();
    view.rerender(<MessageListPane {...initial} listMode="messages" />);
    await settle(request);
    expect(screen.queryByRole('menu')).toBeNull();
    const afterUnmount = deferred();
    view.rerender(<MessageListPane {...initial} onLoadThreadMessages={() => afterUnmount.promise} />);
    openMenu(); view.unmount();
    await act(async () => { afterUnmount.reject(new Error('cancelled')); await afterUnmount.promise.catch(() => undefined); });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
