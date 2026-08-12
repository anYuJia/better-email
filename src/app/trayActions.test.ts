import { describe, expect, it, vi } from 'vitest';
import { openUnreadInbox } from './trayActions';
import type { Folder } from './types';

const folders: Folder[] = [
  { id: 101, account_id: 1, name: '收件箱', role: 'inbox', unread_count: 3, is_virtual: false },
  { id: 102, account_id: 1, name: '归档', role: 'archive', unread_count: 0, is_virtual: false },
];

describe('openUnreadInbox (tray://open-unread)', () => {
  it('clears the search query, restores folder scope and opens the inbox unread view', () => {
    const resetSearch = vi.fn();
    const setFilter = vi.fn();
    const setFolderId = vi.fn();
    const setActiveThread = vi.fn();
    const setThreadMessages = vi.fn();
    const setSelectedId = vi.fn();
    const setSelectedMessageIds = vi.fn();

    openUnreadInbox({
      folders,
      resetSearch,
      setFilter,
      setFolderId,
      setActiveThread,
      setThreadMessages,
      setSelectedId,
      setSelectedMessageIds,
    });

    // 清空搜索词 + 恢复 folder 范围（resetSearch 内部把 query 置空、scope 置 folder）。
    expect(resetSearch).toHaveBeenCalled();
    // 切到收件箱未读。
    expect(setFilter).toHaveBeenCalledWith('unread');
    expect(setFolderId).toHaveBeenCalledWith(101);
    // 清空线程与选择状态。
    expect(setActiveThread).toHaveBeenCalledWith(null);
    expect(setThreadMessages).toHaveBeenCalledWith([]);
    expect(setSelectedId).toHaveBeenCalledWith(null);
    expect(setSelectedMessageIds).toHaveBeenCalledWith([]);
  });

  it('does not change the folder when no inbox role exists', () => {
    const setFolderId = vi.fn();
    openUnreadInbox({
      folders: [{ id: 9, account_id: 1, name: '自定义', role: 'custom:1', unread_count: 0, is_virtual: false }],
      resetSearch: vi.fn(),
      setFilter: vi.fn(),
      setFolderId,
      setActiveThread: vi.fn(),
      setThreadMessages: vi.fn(),
      setSelectedId: vi.fn(),
      setSelectedMessageIds: vi.fn(),
    });
    expect(setFolderId).not.toHaveBeenCalled();
  });
});
