import { useRef, useState, startTransition, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
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
import {
  buildMailboxListStateKey,
  loadMailboxMessageLimit,
  saveMailboxListState,
} from '../app/mailboxListState';
import {
  buildMailboxCountRequest,
  buildMailboxRequests,
  checkHistoryIncomplete,
  mailboxFlowLog,
  mailboxFlowWarn,
} from './mailboxDataRequests';
import type {
  LoadMetaOptions,
  LoadMetaResult,
  MailboxRefreshRequest,
} from './useAppMetaLoader';
import { MailboxLoadError } from './mailboxLoadError';
import { IPC } from '../ipc/commands';
import { reportStartupMilestone } from '../startupTelemetry';

const THREAD_PAGE_LIMIT = 80;

type PendingThreadRequest = {
  promise: Promise<ThreadSummary[]>;
};

export type MailboxThreadLoader = ((
  nextFolderId?: number | null,
  nextQuery?: string,
  nextFilter?: FilterMode,
  nextScope?: AccountScope,
  refreshId?: number,
  nextSearchScope?: SearchScope,
) => Promise<ThreadSummary[]>) & { invalidate?: () => void };

function mergeMessagePage(
  current: MessageSummary[],
  page: MessageSummary[],
): MessageSummary[] {
  if (page.length === 0) return current;
  const knownIds = new Set(current.map((message) => message.id));
  return current.concat(page.filter((message) => !knownIds.has(message.id)));
}

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
  messages?: MessageSummary[];
  setMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setMessageCount?: Dispatch<SetStateAction<number | null>>;
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

export type MailboxLoadRequest = {
  folderId?: number | null;
  query?: string;
  filter?: FilterMode;
  accountScope?: AccountScope;
  refreshId?: number;
  limit?: number;
  searchScope?: SearchScope;
  includeThreads?: boolean;
  mailboxRequest?: MailboxRefreshRequest;
  offset?: number;
  returnPageOnly?: boolean;
};

export type MailboxDataController = {
  mailboxView: { pending: boolean; unavailable: boolean; error: string | null; committedKey: string | null };
  retryMailbox: () => Promise<unknown>;
  mailboxRefreshRef: MutableRefObject<number>;
  loadMailbox: (request: MailboxLoadRequest) => Promise<MessageSummary[]>;
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
    nextOffset?: number,
    nextReturnPageOnly?: boolean,
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
    nextOffset?: number,
    nextReturnPageOnly?: boolean,
  ) => Promise<MessageSummary[]>;
  loadThreads: MailboxThreadLoader;
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
  messages = [],
  setMessages,
  setMessageCount,
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
  const activeViewKey = buildMailboxListStateKey({ accountScope, folderId, query, filter, searchScope, listSort });
  const [committedKey, setCommittedKey] = useState<string | null>(null);
  const [committedThreadKey, setCommittedThreadKey] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<{ key: string; message: string } | null>(null);
  const [metadataFailure, setMetadataFailure] = useState<{ scope: AccountScope; generation: number; message: string } | null>(null);
  const [viewError, setViewError] = useState<{ key: string; message: string } | null>(null);
  const frontendReadyRef = useRef(false);
  const threadCacheRef = useRef<Map<string, ThreadSummary[]>>(new Map());
  const threadInflightRef = useRef<Map<string, PendingThreadRequest>>(new Map());
  const threadCacheEpochRef = useRef(0);
  const threadRequestEpochRef = useRef(0);
  const messagePageBufferRef = useRef<{ key: string; messages: MessageSummary[] } | null>(null);
  const messageCountRequestRef = useRef(0);
  const messageSnapshotEpochRef = useRef(0);
  const threadSnapshotRef = useRef<{ key: string; epoch: number } | null>(null);
  const internalMailboxRefreshRef = useRef(0);
  const mailboxRefreshRef = mailboxRefreshRefProp ?? internalMailboxRefreshRef;
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
    nextOffset = 0,
    nextReturnPageOnly = false,
  ) {
    return loadMailbox({
      folderId: nextFolderId, query: nextQuery, filter: nextFilter, accountScope: nextScope,
      refreshId, limit: nextLimit, searchScope: nextSearchScope, includeThreads: nextIncludeThreads,
      mailboxRequest, offset: nextOffset, returnPageOnly: nextReturnPageOnly,
    });
  }

  async function loadMailbox({
    folderId: nextFolderId = folderId,
    query: nextQuery = query,
    filter: nextFilter = filter,
    accountScope: nextScope = accountScope,
    refreshId = mailboxRefreshRef.current,
    limit: nextLimit,
    searchScope: nextSearchScope = searchScope,
    includeThreads: nextIncludeThreads = listMode === 'threads',
    mailboxRequest,
    offset: nextOffset = 0,
    returnPageOnly: nextReturnPageOnly = false,
  }: MailboxLoadRequest) {
    // A navigation generation can contain several refreshes (read/star,
    // sync, draft save). Only the latest visible snapshot owns list commits;
    // pagination belongs to the snapshot from which it was requested.
    // Independent select-all reads must not invalidate the visible list.
    const startsSnapshot = nextOffset === 0 && !nextReturnPageOnly
      && isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest);
    if (startsSnapshot) messageSnapshotEpochRef.current += 1;
    const snapshotEpoch = messageSnapshotEpochRef.current;
    const isSnapshotCurrent = () => (nextReturnPageOnly || snapshotEpoch === messageSnapshotEpochRef.current)
      && isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest);
    const stateKey = buildMailboxListStateKey({
      accountScope: nextScope, folderId: nextFolderId, query: nextQuery,
      filter: nextFilter, searchScope: nextSearchScope, listSort,
    });
    if (startsSnapshot) { setViewError(null); setMetadataFailure(null); }
    if (nextSearchScope === 'folder' && !nextFolderId) {
      mailboxFlowLog('loadMessages skipped: missing folder', {
        searchScope: nextSearchScope,
        scope: nextScope,
      });
      if (!nextReturnPageOnly && isSnapshotCurrent()) {
        startTransition(() => {
          setCommittedKey(stateKey);
          setCommittedThreadKey(stateKey);
          setMessageCount?.(null);
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
    if (startsSnapshot) {
      threadCacheRef.current.clear();
      // A full mailbox reload invalidates both completed and in-flight thread
      // reads. The old Promise cannot be cancelled reliably, so its epoch is
      // checked before it is allowed to repopulate the cache or commit rows.
      threadCacheEpochRef.current += 1;
      threadRequestEpochRef.current += 1;
      threadInflightRef.current.clear();
    }
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
      nextOffset,
    );
    const shouldLoadMessageCount = Boolean(setMessageCount)
      && nextOffset === 0
      && !nextReturnPageOnly
      && !nextIncludeThreads;
    const messageCountRequestId = shouldLoadMessageCount
      ? messageCountRequestRef.current + 1
      : messageCountRequestRef.current;
    if (shouldLoadMessageCount) {
      messageCountRequestRef.current = messageCountRequestId;
      if (nextOffset === 0 && isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)) {
        setMessageCount?.(null);
      }
    }
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
      if (startsSnapshot && isSnapshotCurrent()) {
        setViewError({ key: stateKey, message: '邮件列表未能加载，请重试。' });
      }
      mailboxFlowWarn('loadMessages failed', {
        scope: nextScope,
        folderId: nextFolderId ?? 0,
        searchScope: nextSearchScope,
        requestMessages: requests.messages,
        error: error instanceof Error ? error.message : String(error),
      });
      throw startsSnapshot ? new MailboxLoadError(error) : error;
    }
    if (!isSnapshotCurrent()) {
      mailboxFlowLog('loadMessages ignored stale mailbox result', {
        scope: nextScope,
        currentScope: activeMailboxScopeRef.current,
        folderId: nextFolderId ?? 0,
        refreshId,
        currentRefreshId: mailboxRefreshRef.current,
      });
      return nextMessages;
    }
    const pageMessages = nextMessages.slice(0, effectiveLimit);
    const messageBuffer = messagePageBufferRef.current;
    const pageBase = nextOffset > 0 && messageBuffer?.key === stateKey
      ? messageBuffer.messages
      : messages;
    const visibleMessages = nextReturnPageOnly
      ? pageMessages
      : nextOffset > 0
        ? mergeMessagePage(pageBase, pageMessages)
        : pageMessages;
    const hasMoreRemote = checkHistoryIncomplete(
      nextFolderId,
      nextScope,
      currentAccountId,
      folders,
      imapMailboxes
    );
    const visibleMessageIds = new Set(visibleMessages.map((message) => message.id));
    if (nextReturnPageOnly) return visibleMessages;
    messagePageBufferRef.current = { key: stateKey, messages: visibleMessages };
    // Persist the expanded page before the row transition commits.  A user
    // can invoke a bulk action immediately after loading more; its refresh
    // callback may still come from the previous render, so it must be able to
    // read the latest limit without waiting for the effects pass.
    saveMailboxListState(stateKey, { limit: effectiveLimit });
    // Keep the pagination cursor observable before the lower-priority row
    // transition commits.  Bulk actions can be triggered immediately after
    // "加载更多" resolves; refreshes must retain the expanded limit instead
    // of falling back to the original page size in that narrow window.
    setMessageLimit(effectiveLimit);
    setHasMoreMessages(nextMessages.length > effectiveLimit || hasMoreRemote);
    startTransition(() => {
      setCommittedKey(stateKey);
      setViewError(null);
      if (nextIncludeThreads) {
        threadSnapshotRef.current = { key: stateKey, epoch: snapshotEpoch };
        setCommittedThreadKey(stateKey);
        setThreadError(null);
        setThreads(nextThreads);
      } else if (threadSnapshotRef.current?.key !== stateKey || threadSnapshotRef.current.epoch !== snapshotEpoch) {
        setCommittedThreadKey(null);
        setThreads([]);
      }
      setMessages(visibleMessages);
      // Loading another page must not discard IDs already selected from the
      // complete result. Only a fresh scope load may prune stale selections.
      if (nextOffset === 0) {
        setSelectedMessageIds((current) =>
          current.filter((id) => visibleMessageIds.has(id)),
        );
      }
      setSelectedId((current) => {
        if (current && visibleMessageIds.has(current)) return current;
        return visibleMessages[0]?.id ?? null;
      });
    });
    // Prioritize the first page before scheduling the independent exact
    // count query. Pagination keeps the established count.
    if (shouldLoadMessageCount) {
      void invoke<number>(
        IPC.GetMessageCount,
        buildMailboxCountRequest(
          nextScope,
          currentAccountId,
          nextFolderId ?? 0,
          nextSearchScope,
          nextQuery,
          nextFilter,
        ),
      )
        .then((count) => {
          if (
            typeof count !== 'number'
            || !Number.isFinite(count)
            || count < 0
            || messageCountRequestId !== messageCountRequestRef.current
            || !isSnapshotCurrent()
          ) return;
          setMessageCount?.(Math.floor(count));
        })
        .catch((error) => {
          // The list itself remains usable if a count query fails. The loaded
          // row count is the safe fallback until the next successful refresh.
          mailboxFlowWarn('message count query failed', {
            scope: nextScope,
            folderId: nextFolderId ?? 0,
            searchScope: nextSearchScope,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    if (!frontendReadyRef.current) {
      frontendReadyRef.current = true;
      void reportStartupMilestone('first_message_list_query_complete');
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
    nextOffset = 0,
    nextReturnPageOnly = false,
  ) {
    const messageRequest = loadMessages(
      nextFolderId,
      nextQuery,
      nextFilter,
      nextScope,
      refreshId,
      nextLimit,
      nextSearchScope,
      nextIncludeThreads,
      mailboxRequest,
      nextOffset,
      nextReturnPageOnly,
    );
    const snapshotEpoch = messageSnapshotEpochRef.current;
    const nextMessages = await messageRequest;
    if (
      snapshotEpoch !== messageSnapshotEpochRef.current
      || !isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)
    ) {
      return nextMessages;
    }
    if (
      nextMessages.length > 0
      || nextSearchScope !== 'folder'
      || nextOffset > 0
      || nextReturnPageOnly
      || !nextFolderId
      || nextQuery.trim()
      || nextFilter !== 'all'
      || !isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)
    ) {
      return nextMessages;
    }

    const selectedFolder = visibleFolders.find((folder) => folder.id === nextFolderId);
    if (!selectedFolder || selectedFolder.unread_count <= 0) return nextMessages;
    const unreadRequest = loadMessages(
      nextFolderId,
      '',
      'unread',
      nextScope,
      refreshId,
      nextLimit,
      nextSearchScope,
      nextIncludeThreads,
      mailboxRequest,
      nextOffset,
      true,
    );
    const unreadSnapshotEpoch = messageSnapshotEpochRef.current;
    const unreadMessages = await unreadRequest;
    if (
      unreadMessages.length === 0
      || unreadSnapshotEpoch !== messageSnapshotEpochRef.current
      || !isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)
    ) {
      return nextMessages;
    }
    setFilter('unread');
    setStatus('当前文件夹暂无全部邮件，已切到未读视图显示可见邮件。');
    return loadMessages(nextFolderId, '', 'unread', nextScope, refreshId, nextLimit,
      nextSearchScope, nextIncludeThreads, mailboxRequest);
  }

  async function refreshMailbox(
    nextScope: AccountScope = accountScope,
    preferredFolderId: number | null = null,
    nextQuery = query,
    nextFilter = filter,
  ) {
    const refreshId = mailboxRefreshRef.current + 1;
    mailboxRefreshRef.current = refreshId;
    // Invalidate thread reads at the same boundary as the mailbox refresh.
    // Otherwise a quick toggle during the metadata round-trip could reuse a
    // response from the previous folder/account generation.
    threadCacheRef.current.clear();
    threadCacheEpochRef.current += 1;
    threadRequestEpochRef.current += 1;
    threadInflightRef.current.clear();
    const mailboxRequest: MailboxRefreshRequest = { id: refreshId, scope: nextScope };
    setCommittedKey(null);
    setCommittedThreadKey(null);
    setHasMoreMessages(false);
    setMessageCount?.(null);
    setMessages([]);
    setThreads([]);
    setSelectedId(null);
    setSelectedMessageIds([]);
    setMetadataFailure(null);
    let meta: LoadMetaResult;
    try {
      meta = await loadMeta(preferredFolderId, nextScope, { mode: 'mailbox', mailboxRequest });
    } catch (error) {
      if (isMailboxRequestCurrent(nextScope, refreshId, mailboxRequest)) {
        setMetadataFailure({ scope: nextScope, generation: refreshId, message: '邮箱信息未能加载，请重试。' });
      }
      throw error;
    }
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

  async function loadThreads(
    nextFolderId = folderId,
    nextQuery = query,
    nextFilter = filter,
    nextScope: AccountScope = accountScope,
    refreshId = mailboxRefreshRef.current,
    nextSearchScope = searchScope,
  ) {
    const stateKey = buildMailboxListStateKey({ accountScope: nextScope, folderId: nextFolderId,
      query: nextQuery, filter: nextFilter, searchScope: nextSearchScope, listSort });
    const requestEpoch = threadRequestEpochRef.current;
    const canCommit = () => requestEpoch === threadRequestEpochRef.current && isMailboxRequestCurrent(nextScope, refreshId);
    const commit = (next: ThreadSummary[]) => {
      if (!canCommit()) return;
      threadSnapshotRef.current = { key: stateKey, epoch: messageSnapshotEpochRef.current };
      setThreads(next);
      setCommittedThreadKey(stateKey);
      setThreadError(null);
    };
    if (canCommit()) setThreadError(null);
    if (nextSearchScope === 'folder' && !nextFolderId) { commit([]); return []; }
    try {
      const cacheKey = JSON.stringify([
        nextScope,
        currentAccountId,
        nextFolderId,
        nextQuery.trim(),
        nextFilter,
        nextSearchScope,
        listSort,
      ]);
      const cacheEpoch = threadCacheEpochRef.current;
      const cachedThreads = threadCacheRef.current.get(cacheKey);
      if (cachedThreads) {
        commit(cachedThreads);
        return cachedThreads;
      }
      const pendingRequest = threadInflightRef.current.get(cacheKey);
      if (pendingRequest) {
        const nextThreads = await pendingRequest.promise;
        if (
          requestEpoch !== threadRequestEpochRef.current
          || !isMailboxRequestCurrent(nextScope, refreshId)
        ) return nextThreads;
        commit(nextThreads);
        return nextThreads;
      }
      const requests = buildMailboxRequests(
        nextScope,
        currentAccountId,
        nextFolderId ?? 0,
        nextSearchScope,
        nextQuery,
        nextFilter,
        listSort,
        THREAD_PAGE_LIMIT,
      );
      let threadRequest!: Promise<ThreadSummary[]>;
      threadRequest = invoke<ThreadSummary[]>(IPC.ListThreads, requests.threads)
        .then((nextThreads) => {
          if (cacheEpoch === threadCacheEpochRef.current) {
            threadCacheRef.current.set(cacheKey, nextThreads);
          }
          return nextThreads;
        })
        .finally(() => {
          const current = threadInflightRef.current.get(cacheKey);
          if (current?.promise === threadRequest) threadInflightRef.current.delete(cacheKey);
        });
      threadInflightRef.current.set(cacheKey, { promise: threadRequest });
      const nextThreads = await threadRequest;
      if (
        requestEpoch !== threadRequestEpochRef.current
        || !isMailboxRequestCurrent(nextScope, refreshId)
      ) return nextThreads;
      commit(nextThreads);
      return nextThreads;
    } catch (error) {
      if (canCommit()) setThreadError({ key: stateKey, message: '会话列表未能加载，请重试。' });
      throw error;
    }
  }

  function invalidateThreads() {
    // Presentation changes should not advance mailboxRefreshRef: doing so
    // would make an in-flight first message page stale. Only thread commits
    // are invalidated, while a still-valid result may populate the cache for
    // the next switch back to the thread view.
    threadRequestEpochRef.current += 1;
  }

  const threadLoader = Object.assign(loadThreads, { invalidate: invalidateThreads });

  const needsMetadata = metadataFailure?.scope === accountScope && metadataFailure.generation === mailboxRefreshRef.current;
  const error = needsMetadata ? metadataFailure.message : listMode === 'threads' && threadError?.key === activeViewKey
    ? threadError.message : viewError?.key === activeViewKey ? viewError.message : null;
  const unavailable = committedKey !== activeViewKey || (listMode === 'threads' && committedThreadKey !== activeViewKey);
  return {
    mailboxView: { pending: unavailable && !error, unavailable, error, committedKey },
    retryMailbox: () => needsMetadata
      ? refreshMailbox(accountScope, folderId, query, filter)
      : loadMailbox({}),
    mailboxRefreshRef,
    loadMailbox,
    loadMessages,
    loadMessagesWithVisibleFallback,
    loadThreads: threadLoader,
    refreshMailbox,
  };
}
