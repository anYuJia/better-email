import { useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { messagePageSize } from '../app/appConfig';
import type {
  AccountScope,
  FilterMode,
  Folder,
  ListSort,
  Message,
  SearchScope,
  ThreadSummary,
  ImapMailboxState,
} from '../app/types';
import { flowInfo, flowWarn } from '../app/logger';
import { invoke } from '../tauriBridge';

type LoadMetaResult = {
  folderId: number | null;
  folders: Folder[];
};

type MailboxRequestArgs = {
  accountId: number | null;
  folderId: number | null;
  query: string | null;
  filter: FilterMode;
  sort: ListSort;
  limit: number;
};

type UseMailboxDataOptions = {
  accountScope: AccountScope;
  currentAccountId: number | null;
  folderId: number | null;
  searchScope: SearchScope;
  query: string;
  filter: FilterMode;
  listSort: ListSort;
  folders: Folder[];
  imapMailboxes: ImapMailboxState[];
  messageLimit: number;
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

function mailboxFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('mailbox-flow', event, details);
}

function mailboxFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('mailbox-flow', event, details);
}

export function buildMailboxRequests(
  scope: AccountScope,
  currentAccountId: number | null,
  folderId: number,
  searchScope: SearchScope,
  query: string,
  filter: FilterMode,
  sort: ListSort,
  limit: number,
): MailboxRequests {
  const trimmedQuery = query.trim();
  const effectiveSearchScope = trimmedQuery ? searchScope : 'folder';
  const accountId = effectiveSearchScope === 'all'
    ? null
    : effectiveSearchScope === 'account'
      ? currentAccountId
      : scope === 'all'
        ? null
        : scope;
  const scopedFolderId = effectiveSearchScope === 'folder' ? folderId : null;
  const common = {
    accountId,
    folderId: scopedFolderId,
    query: trimmedQuery || null,
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
    nextSearchScope?: SearchScope,
  ) => Promise<Message[]>;
  loadMessagesWithVisibleFallback: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
    refreshId?: number,
    visibleFolders?: Folder[],
    nextLimit?: number,
    nextSearchScope?: SearchScope,
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
  currentAccountId,
  folderId,
  searchScope,
  query,
  filter,
  listSort,
  folders,
  imapMailboxes,
  messageLimit,
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
    nextLimit = messageLimit,
    nextSearchScope = searchScope,
  ) {
    if (nextSearchScope === 'folder' && !nextFolderId) {
      mailboxFlowLog('loadMessages skipped: missing folder', {
        searchScope: nextSearchScope,
        scope: nextScope,
      });
      setMessages([]);
      setThreads([]);
      setHasMoreMessages(false);
      setSelectedId(null);
      setSelectedMessageIds([]);
      return [];
    }
    const startedAt = performance.now();
    const requests = buildMailboxRequests(
      nextScope,
      currentAccountId,
      nextFolderId ?? 0,
      nextSearchScope,
      nextQuery,
      nextFilter,
      listSort,
      nextLimit,
    );
    mailboxFlowLog('loadMessages start', {
      scope: nextScope,
      currentAccountId,
      folderId: nextFolderId ?? 0,
      searchScope: nextSearchScope,
      query: nextQuery.trim() || null,
      filter: nextFilter,
      sort: listSort,
      requestMessages: requests.messages,
      requestThreads: requests.threads,
    });
    let nextMessages: Message[];
    let nextThreads: ThreadSummary[];
    try {
      [nextMessages, nextThreads] = await Promise.all([
        invoke<Message[]>('list_messages', requests.messages),
        invoke<ThreadSummary[]>('list_threads', requests.threads),
      ]);
    } catch (error) {
      mailboxFlowWarn('loadMessages failed', {
        scope: nextScope,
        folderId: nextFolderId ?? 0,
        searchScope: nextSearchScope,
        requestMessages: requests.messages,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    if (refreshId !== mailboxRefreshRef.current) return nextMessages;
    setThreads(nextThreads);
    const visibleMessages = nextMessages.slice(0, nextLimit);
    setMessageLimit(nextLimit);
    const currentMailbox = imapMailboxes?.find((m) => m.local_folder_id === nextFolderId);
    const hasMoreRemote = currentMailbox ? !currentMailbox.history_complete : false;
    setHasMoreMessages(nextMessages.length > nextLimit || hasMoreRemote);
    setMessages(visibleMessages);
    const visibleMessageIds = new Set(visibleMessages.map((message) => message.id));
    setSelectedMessageIds((current) =>
      current.filter((id) => visibleMessageIds.has(id)),
    );
    setSelectedId((current) => {
      if (current && visibleMessageIds.has(current)) return current;
      return visibleMessages[0]?.id ?? null;
    });
    if (!frontendReadyRef.current) {
      frontendReadyRef.current = true;
      void invoke('mark_frontend_ready', {
        message: `folder=${nextFolderId};messages=${visibleMessages.length};scope=${nextScope}`,
      });
      void maybeRunBenchmarkSync();
    }
    mailboxFlowLog('loadMessages done', {
      scope: nextScope,
      folderId: nextFolderId ?? 0,
      searchScope: nextSearchScope,
      messageCount: nextMessages.length,
      visibleCount: visibleMessages.length,
      threadCount: nextThreads.length,
      selectedId: visibleMessages[0]?.id ?? null,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return visibleMessages;
  }

  async function loadMessagesWithVisibleFallback(
    nextFolderId = folderId,
    nextQuery = query,
    nextFilter = filter,
    nextScope: AccountScope = accountScope,
    refreshId = mailboxRefreshRef.current,
    visibleFolders = folders,
    nextLimit = messageLimit,
    nextSearchScope = searchScope,
  ) {
    const nextMessages = await loadMessages(
      nextFolderId,
      nextQuery,
      nextFilter,
      nextScope,
      refreshId,
      nextLimit,
      nextSearchScope,
    );
    if (
      nextMessages.length > 0
      || nextSearchScope !== 'folder'
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
      searchScope,
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
