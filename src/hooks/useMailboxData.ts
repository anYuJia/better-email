import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { messagePageSize } from '../app/appConfig';
import type {
  AccountScope,
  FilterMode,
  Folder,
  ListSort,
  Message,
  ThreadSummary,
} from '../app/types';
import { invoke } from '../tauriBridge';

type LoadMetaResult = {
  folderId: number | null;
  folders: Folder[];
};

type MailboxRequestArgs = {
  accountId: number | null;
  folderId: number;
  query: string | null;
  filter: FilterMode;
  sort: ListSort;
  limit: number;
};

type UseMailboxDataOptions = {
  accountScope: AccountScope;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  listSort: ListSort;
  folders: Folder[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setThreads: Dispatch<SetStateAction<ThreadSummary[]>>;
  setMessageLimit: Dispatch<SetStateAction<number>>;
  setHasMoreMessages: Dispatch<SetStateAction<boolean>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setSelectedMessageIds: Dispatch<SetStateAction<number[]>>;
  setFilter: Dispatch<SetStateAction<FilterMode>>;
  setStatus: Dispatch<SetStateAction<string>>;
  loadMeta: (
    nextFolderId?: number | null,
    nextScope?: AccountScope,
  ) => Promise<LoadMetaResult>;
  maybeRunBenchmarkSync: () => Promise<void>;
};

type MailboxRequests = {
  messages: MailboxRequestArgs;
  threads: MailboxRequestArgs;
};

export function buildMailboxRequests(
  scope: AccountScope,
  folderId: number,
  query: string,
  filter: FilterMode,
  sort: ListSort,
  limit: number,
): MailboxRequests {
  const common = {
    accountId: scope === 'all' ? null : scope,
    folderId,
    query: query.trim() || null,
    filter,
    sort,
  };
  return {
    messages: {
      ...common,
      limit: limit + 1,
    },
    threads: {
      ...common,
      limit: 80,
    },
  };
}

export type MailboxDataController = {
  mailboxRefreshRef: MutableRefObject<number>;
  loadMessages: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
    refreshId?: number,
    nextLimit?: number,
  ) => Promise<Message[]>;
  loadMessagesWithVisibleFallback: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
    refreshId?: number,
    visibleFolders?: Folder[],
    nextLimit?: number,
  ) => Promise<Message[]>;
  refreshMailbox: (
    nextScope?: AccountScope,
    preferredFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
  ) => Promise<number | null>;
};

export default function useMailboxData({
  accountScope,
  folderId,
  query,
  filter,
  listSort,
  folders,
  setMessages,
  setThreads,
  setMessageLimit,
  setHasMoreMessages,
  setSelectedId,
  setSelectedMessageIds,
  setFilter,
  setStatus,
  loadMeta,
  maybeRunBenchmarkSync,
}: UseMailboxDataOptions): MailboxDataController {
  const frontendReadyRef = useRef(false);
  const mailboxRefreshRef = useRef(0);

  async function loadMessages(
    nextFolderId = folderId,
    nextQuery = query,
    nextFilter = filter,
    nextScope: AccountScope = accountScope,
    refreshId = mailboxRefreshRef.current,
    nextLimit = messagePageSize,
  ) {
    if (!nextFolderId) {
      setMessages([]);
      setThreads([]);
      setHasMoreMessages(false);
      setSelectedId(null);
      setSelectedMessageIds([]);
      return [];
    }
    const requests = buildMailboxRequests(
      nextScope,
      nextFolderId,
      nextQuery,
      nextFilter,
      listSort,
      nextLimit,
    );
    const [nextMessages, nextThreads] = await Promise.all([
      invoke<Message[]>('list_messages', requests.messages),
      invoke<ThreadSummary[]>('list_threads', requests.threads),
    ]);
    if (refreshId !== mailboxRefreshRef.current) return nextMessages;
    setThreads(nextThreads);
    const visibleMessages = nextMessages.slice(0, nextLimit);
    setMessageLimit(nextLimit);
    setHasMoreMessages(nextMessages.length > nextLimit);
    setMessages(visibleMessages);
    setSelectedMessageIds((current) =>
      current.filter((id) => visibleMessages.some((message) => message.id === id)),
    );
    setSelectedId((current) => {
      if (current && visibleMessages.some((message) => message.id === current)) return current;
      return visibleMessages[0]?.id ?? null;
    });
    if (!frontendReadyRef.current) {
      frontendReadyRef.current = true;
      void invoke('mark_frontend_ready', {
        message: `folder=${nextFolderId};messages=${visibleMessages.length};scope=${nextScope}`,
      });
      void maybeRunBenchmarkSync();
    }
    return visibleMessages;
  }

  async function loadMessagesWithVisibleFallback(
    nextFolderId = folderId,
    nextQuery = query,
    nextFilter = filter,
    nextScope: AccountScope = accountScope,
    refreshId = mailboxRefreshRef.current,
    visibleFolders = folders,
    nextLimit = messagePageSize,
  ) {
    const nextMessages = await loadMessages(
      nextFolderId,
      nextQuery,
      nextFilter,
      nextScope,
      refreshId,
      nextLimit,
    );
    if (
      nextMessages.length > 0
      || !nextFolderId
      || nextQuery.trim()
      || nextFilter !== 'all'
      || refreshId !== mailboxRefreshRef.current
    ) {
      return nextMessages;
    }

    const selectedFolder = visibleFolders.find((folder) => folder.id === nextFolderId);
    if (!selectedFolder || selectedFolder.unread_count <= 0) return nextMessages;
    const unreadMessages = await loadMessages(
      nextFolderId,
      '',
      'unread',
      nextScope,
      refreshId,
      nextLimit,
    );
    if (unreadMessages.length === 0 || refreshId !== mailboxRefreshRef.current) {
      return nextMessages;
    }
    setFilter('unread');
    setStatus('当前文件夹暂无全部邮件，已切到未读视图显示可见邮件。');
    return unreadMessages;
  }

  async function refreshMailbox(
    nextScope: AccountScope = accountScope,
    preferredFolderId: number | null = null,
    nextQuery = query,
    nextFilter = filter,
  ) {
    const refreshId = mailboxRefreshRef.current + 1;
    mailboxRefreshRef.current = refreshId;
    setMessageLimit(messagePageSize);
    setHasMoreMessages(false);
    setMessages([]);
    setThreads([]);
    setSelectedId(null);
    setSelectedMessageIds([]);
    const meta = await loadMeta(preferredFolderId, nextScope);
    const nextFolderId = meta.folderId;
    if (refreshId !== mailboxRefreshRef.current) return nextFolderId;
    await loadMessagesWithVisibleFallback(
      nextFolderId,
      nextQuery,
      nextFilter,
      nextScope,
      refreshId,
      meta.folders,
      messagePageSize,
    );
    return nextFolderId;
  }

  return {
    mailboxRefreshRef,
    loadMessages,
    loadMessagesWithVisibleFallback,
    refreshMailbox,
  };
}
