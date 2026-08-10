import { useRef, startTransition, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type {
  AccountScope,
  FilterMode,
  Folder,
  ListMode,
  ListSort,
  MessageSummary,
  SearchScope,
  ThreadSummary,
  ImapMailboxState,
} from '../app/types';
import { invoke } from '../tauriBridge';
import { buildMailboxListStateKey, loadMailboxMessageLimit } from '../app/mailboxListState';
import { buildMailboxRequests, checkHistoryIncomplete, mailboxFlowLog, mailboxFlowWarn } from './mailboxDataRequests';
import type {
  LoadMetaOptions,
  LoadMetaResult,
  MailboxRefreshRequest,
} from './useAppMetaLoader';
import { IPC } from '../ipc/commands';

type UseMailboxDataOptions = {
  accountScope: AccountScope;
  currentAccountId: number | null;
  folderId: number | null;
  searchScope: SearchScope;
  query: string;
  filter: FilterMode;
  listMode: ListMode;
  listSort: ListSort;
  folders: Folder[];
  imapMailboxes: ImapMailboxState[];
  setMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setThreads: Dispatch<SetStateAction<ThreadSummary[]>>;
  setMessageLimit: Dispatch<SetStateAction<number>>;
  setHasMoreMessages: Dispatch<SetStateAction<boolean>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setSelectedMessageIds: Dispatch<SetStateAction<number[]>>;
  setFilter: Dispatch<SetStateAction<FilterMode>>;
  setStatus: Dispatch<SetStateAction<string>>;
  mailboxRefreshRef?: MutableRefObject<number>;
  loadMeta: (
    nextFolderId?: number | null,
    nextScope?: AccountScope,
    options?: LoadMetaOptions,
  ) => Promise<LoadMetaResult>;
  maybeRunBenchmarkSync: () => Promise<void>;
};

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
    nextIncludeThreads?: boolean,
    mailboxRequest?: MailboxRefreshRequest,
  ) => Promise<MessageSummary[]>;
  loadMessagesWithVisibleFallback: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
    refreshId?: number,
    visibleFolders?: Folder[],
    nextLimit?: number,
    nextSearchScope?: SearchScope,
    nextIncludeThreads?: boolean,
    mailboxRequest?: MailboxRefreshRequest,
  ) => Promise<MessageSummary[]>;
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
  listMode,
  listSort,
  folders,
  imapMailboxes,
  setMessages,
  setThreads,
  setMessageLimit,
  setHasMoreMessages,
  setSelectedId,
  setSelectedMessageIds,
  setFilter,
  setStatus,
  mailboxRefreshRef: mailboxRefreshRefProp,
  loadMeta,
  maybeRunBenchmarkSync,
}: UseMailboxDataOptions): MailboxDataController {
  const frontendReadyRef = useRef(false);
  const mailboxRefreshRef = mailboxRefreshRefProp ?? useRef(0);
  const activeMailboxScopeRef = useRef<AccountScope>(accountScope);
  activeMailboxScopeRef.current = accountScope;

  function isMailboxRequestCurrent(
    nextScope: AccountScope,
    refreshId: number,
    mailboxRequest?: MailboxRefreshRequest,
  ): boolean {
    if (refreshId !== mailboxRefreshRef.current) return false;
    if (!mailboxRequest) return true;
    return (
      mailboxRequest.id === refreshId
      && mailboxRequest.scope === nextScope
      && activeMailboxScopeRef.current === nextScope
    );
  }

  async function loadMessages(
    nextFolderId = folderId,
    nextQuery = query,
    nextFilter = filter,
    nextScope: AccountScope = accountScope,
    refreshId = mailboxRefreshRef.current,
    nextLimit?: number,
    nextSearchScope = searchScope,
    nextIncludeThreads = listMode === 'threads',
    mailboxRequest?: MailboxRefreshRequest,
  ) {
    if (nextSearchScope === 'folder' && !nextFolderId) {
      mailboxFlowLog('loadMessages skipped: missing folder', {
        searchScope: nextSearchScope,
        scope: nextScope,
      });
      if (isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)) {
        startTransition(() => {
          setMessages([]);
          setThreads([]);
          setHasMoreMessages(false);
          setSelectedId(null);
          setSelectedMessageIds([]);
        });
      }
      return [];
    }
    const startedAt = performance.now();
    const stateKey = buildMailboxListStateKey({
      accountScope: nextScope,
      folderId: nextFolderId,
      query: nextQuery,
      filter: nextFilter,
      searchScope: nextSearchScope,
      listSort,
    });
    const effectiveLimit = nextLimit ?? loadMailboxMessageLimit(stateKey);
    const requests = buildMailboxRequests(
      nextScope,
      currentAccountId,
      nextFolderId ?? 0,
      nextSearchScope,
      nextQuery,
      nextFilter,
      listSort,
      effectiveLimit,
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
    let nextMessages: MessageSummary[];
    let nextThreads: ThreadSummary[] = [];
    try {
      if (nextIncludeThreads) {
        [nextMessages, nextThreads] = await Promise.all([
          invoke<MessageSummary[]>(IPC.ListMessages, requests.messages),
          invoke<ThreadSummary[]>(IPC.ListThreads, requests.threads),
        ]);
      } else {
        nextMessages = await invoke<MessageSummary[]>(IPC.ListMessages, requests.messages);
      }
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
    if (!isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)) {
      mailboxFlowLog('loadMessages ignored stale mailbox result', {
        scope: nextScope,
        currentScope: activeMailboxScopeRef.current,
        folderId: nextFolderId ?? 0,
        refreshId,
        currentRefreshId: mailboxRefreshRef.current,
      });
      return nextMessages;
    }
    const visibleMessages = nextMessages.slice(0, effectiveLimit);
    const hasMoreRemote = checkHistoryIncomplete(
      nextFolderId,
      nextScope,
      currentAccountId,
      folders,
      imapMailboxes
    );
    const visibleMessageIds = new Set(visibleMessages.map((message) => message.id));
    startTransition(() => {
      setThreads(nextIncludeThreads ? nextThreads : []);
      setMessageLimit(effectiveLimit);
      setHasMoreMessages(nextMessages.length > effectiveLimit || hasMoreRemote);
      setMessages(visibleMessages);
      setSelectedMessageIds((current) =>
        current.filter((id) => visibleMessageIds.has(id)),
      );
      setSelectedId((current) => {
        if (current && visibleMessageIds.has(current)) return current;
        return visibleMessages[0]?.id ?? null;
      });
    });
    if (!frontendReadyRef.current) {
      frontendReadyRef.current = true;
      void invoke(IPC.MarkFrontendReady, {
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
      threadCount: nextIncludeThreads ? nextThreads.length : 0,
      includeThreads: nextIncludeThreads,
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
    nextLimit?: number,
    nextSearchScope = searchScope,
    nextIncludeThreads = listMode === 'threads',
    mailboxRequest?: MailboxRefreshRequest,
  ) {
    const nextMessages = await loadMessages(
      nextFolderId,
      nextQuery,
      nextFilter,
      nextScope,
      refreshId,
      nextLimit,
      nextSearchScope,
      nextIncludeThreads,
      mailboxRequest,
    );
    if (!isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)) {
      return nextMessages;
    }
    if (
      nextMessages.length > 0
      || nextSearchScope !== 'folder'
      || !nextFolderId
      || nextQuery.trim()
      || nextFilter !== 'all'
      || !isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)
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
      nextSearchScope,
      nextIncludeThreads,
      mailboxRequest,
    );
    if (
      unreadMessages.length === 0
      || !isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)
    ) {
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
    const mailboxRequest: MailboxRefreshRequest = { id: refreshId, scope: nextScope };
    setHasMoreMessages(false);
    setMessages([]);
    setThreads([]);
    setSelectedId(null);
    setSelectedMessageIds([]);
    const meta = await loadMeta(preferredFolderId, nextScope, {
      mode: 'mailbox',
      mailboxRequest,
    });
    const nextFolderId = meta.folderId;
    if (!isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)) return nextFolderId;
    await loadMessagesWithVisibleFallback(
      nextFolderId,
      nextQuery,
      nextFilter,
      nextScope,
      refreshId,
      meta.folders,
      undefined,
      searchScope,
      undefined,
      mailboxRequest,
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
