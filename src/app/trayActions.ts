import type { Dispatch, SetStateAction } from 'react';
import type { FilterMode, Folder, MessageSummary, ThreadSummary } from './types';

type OpenUnreadInboxOptions = {
  folders: Folder[];
  resetSearch: () => void;
  setFilter: Dispatch<SetStateAction<FilterMode>>;
  setFolderId: Dispatch<SetStateAction<number | null>>;
  setActiveThread: Dispatch<SetStateAction<ThreadSummary | null>>;
  setThreadMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setSelectedMessageIds: Dispatch<SetStateAction<number[]>>;
};

/**
 * 托盘「打开未读」统一导航入口：先清空搜索词、把搜索范围恢复为 folder、
 * 清空线程/选择状态，再切到收件箱未读视图。避免残留搜索词与 unread 筛选叠加
 * 导致显示旧的搜索结果。
 */
export function openUnreadInbox({
  folders,
  resetSearch,
  setFilter,
  setFolderId,
  setActiveThread,
  setThreadMessages,
  setSelectedId,
  setSelectedMessageIds,
}: OpenUnreadInboxOptions): void {
  resetSearch();
  setFilter('unread');
  const inboxFolder = folders.find((folder) => folder.role === 'inbox');
  if (inboxFolder) {
    setFolderId(inboxFolder.id);
  }
  setActiveThread(null);
  setThreadMessages([]);
  setSelectedId(null);
  setSelectedMessageIds([]);
}
