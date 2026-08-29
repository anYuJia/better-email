import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { messagePageSize } from '../app/appConfig';
import type {
  Account,
  AccountScope,
  FilterMode,
  Folder,
  ImapMailboxState,
  MessageSummary,
  SearchScope,
} from '../app/types';
import type { MailboxSearchLoaders } from './useMailboxSearchController';

// The native list command intentionally caps each page at 200 rows. Larger
// result sets are read as stable offset pages so selection never silently
// stops at the backend's per-request safety limit.
// One extra row is requested by buildMailboxRequests to detect continuation;
// keep the visible page below the Rust 200-row safety cap.
const SELECT_ALL_PAGE_SIZE = 199;

type PendingLoadAllRequest = {
  key: string;
  refreshId: number;
  promise: Promise<MessageSummary[]>;
};

type UseMailboxLoadMoreOptions = {
  account: Account | null;
  accountScope: AccountScope;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  searchScope: SearchScope;
  folders: Folder[];
  imapMailboxes: ImapMailboxState[];
  messages: MessageSummary[];
  mailboxRefreshRef: MutableRefObject<number>;
  loadersRef: MutableRefObject<MailboxSearchLoaders | null>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useMailboxLoadMore({
  account,
  accountScope,
  folderId,
  query,
  filter,
  searchScope,
  folders,
  imapMailboxes,
  messages,
  mailboxRefreshRef,
  loadersRef,
  setStatus,
}: UseMailboxLoadMoreOptions) {
  const [messageLimit, setMessageLimit] = useState(messagePageSize);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadMoreStatus, setLoadMoreStatus] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const loadAllInFlightRef = useRef<PendingLoadAllRequest | null>(null);
  const loadAllBusyRef = useRef(false);
  const loadAllRequestTokenRef = useRef(0);
  const loadedCursorRef = useRef<{ key: string; count: number } | null>(null);

  const loadMoreMessages = useCallback(async () => {
    const loaders = loadersRef.current;
    if (!loaders) return messages;
    if (loadingMoreRef.current) return messages;
    loadingMoreRef.current = true;
    // 捕获发起时的 mailbox 世代：加载更多期间用户导航到别的视图时，
    // 慢响应不得把旧文件夹的追加结果写回新视图。
    const startedRefreshId = mailboxRefreshRef.current;
    const cursorKey = `${accountScope}:${folderId ?? 0}:${query}:${filter}:${searchScope}:${startedRefreshId}`;
    const previousCursor = loadedCursorRef.current;
    if (!previousCursor || previousCursor.key !== cursorKey || messages.length < previousCursor.count) {
      loadedCursorRef.current = { key: cursorKey, count: messages.length };
    }
    const requestOffset = loadedCursorRef.current?.count ?? messages.length;
    setLoadMoreStatus('正在读取本地缓存...');
    try {
      const nextLimit = messagePageSize;
      const nextMessages = await loaders.loadMessagesWithVisibleFallback(
        folderId,
        query,
        filter,
        accountScope,
        startedRefreshId,
        folders,
        nextLimit,
        searchScope,
        false,
        undefined,
        requestOffset,
      );
      if (startedRefreshId !== mailboxRefreshRef.current) return nextMessages;
      loadedCursorRef.current = { key: cursorKey, count: Math.max(requestOffset, nextMessages.length) };
      const folder = folders.find((f) => f.id === folderId);
      const targetAccountId = accountScope === 'all' ? null : account?.id ?? null;
      const scopeMailboxes = targetAccountId
        ? imapMailboxes.filter((m) => m.account_id === targetAccountId)
        : imapMailboxes;

      let targetMailbox = null;
      if (folder) {
        if (folder.is_virtual) {
          targetMailbox = scopeMailboxes.find((m) => m.local_role === folder.role && !m.history_complete);
        } else {
          targetMailbox = scopeMailboxes.find((m) => m.local_folder_id === folder.id && !m.history_complete);
        }
      } else {
        targetMailbox = scopeMailboxes.find((m) => !m.history_complete);
      }

      if (nextMessages.length <= requestOffset && targetMailbox) {
        setStatus('正在从服务器同步历史邮件...');
        setLoadMoreStatus('正在从服务器拉取历史邮件...');
        const run = await loaders.syncImapHistoryPage(targetMailbox.account_id);
        if (startedRefreshId !== mailboxRefreshRef.current) return nextMessages;
        const meta = await loaders.loadMeta(folderId, accountScope, { mode: 'mailbox' });
        if (startedRefreshId !== mailboxRefreshRef.current) return nextMessages;
        const refreshedMessages = await loaders.loadMessagesWithVisibleFallback(
          meta.folderId,
          query,
          filter,
          accountScope,
          startedRefreshId,
          meta.folders,
          nextLimit,
          searchScope,
          false,
          undefined,
          requestOffset,
        );
        loadedCursorRef.current = { key: cursorKey, count: Math.max(requestOffset, refreshedMessages.length) };
        setStatus(`${run.message} · 已显示 ${refreshedMessages.length} 封邮件`);
        return refreshedMessages;
      } else {
        setStatus(`已加载 ${nextMessages.length} 封邮件`);
        return nextMessages;
      }
    } finally {
      loadingMoreRef.current = false;
      if (!loadAllBusyRef.current) setLoadMoreStatus(null);
    }
  }, [
    loadersRef,
    folderId,
    query,
    filter,
    accountScope,
    mailboxRefreshRef,
    folders,
    searchScope,
    account,
    imapMailboxes,
    messages,
    setStatus,
  ]);

  const loadAllMessages = useCallback(() => {
    const loaders = loadersRef.current;
    if (!loaders) return Promise.resolve(messages);
    const startedRefreshId = mailboxRefreshRef.current;
    const key = JSON.stringify([
      accountScope,
      folderId,
      query.trim(),
      filter,
      searchScope,
    ]);
    const pending = loadAllInFlightRef.current;
    if (pending?.key === key && pending.refreshId === startedRefreshId) {
      return pending.promise;
    }

    const requestToken = loadAllRequestTokenRef.current + 1;
    loadAllRequestTokenRef.current = requestToken;
    loadAllBusyRef.current = true;
    setLoadMoreStatus('正在读取全部邮件...');
    const request = (async () => {
      const loadedIds = new Set<number>();
      try {
        let loadedMessages: MessageSummary[] = [];
        let offset = 0;
        while (true) {
          const page = await loaders.loadMessagesWithVisibleFallback(
            folderId,
            query,
            filter,
            accountScope,
            startedRefreshId,
            folders,
            SELECT_ALL_PAGE_SIZE,
            searchScope,
            false,
            undefined,
            offset,
            true,
          );
          if (startedRefreshId !== mailboxRefreshRef.current) return loadedMessages;
          if (page.length === 0) return loadedMessages;
          const newMessages = page.filter((message) => {
            if (loadedIds.has(message.id)) return false;
            loadedIds.add(message.id);
            return true;
          });
          if (newMessages.length === 0) return loadedMessages;
          loadedMessages = loadedMessages.concat(newMessages);
          // Offset tracks rows returned by SQLite, not the React state. The
          // backend returns at most one capped page, so this remains bounded
          // and independent of transition scheduling.
          offset += page.length;
        }
      } finally {
        // A newer scope may already have started another full-result request;
        // an old request must not clear its busy state or status.
        if (loadAllRequestTokenRef.current === requestToken) {
          loadAllBusyRef.current = false;
          if (!loadingMoreRef.current) setLoadMoreStatus(null);
        }
      }
    })();
    loadAllInFlightRef.current = { key, refreshId: startedRefreshId, promise: request };
    // Use both fulfillment and rejection handlers so cleanup never creates an
    // unhandled rejection of its own. A changed context can leave this entry
    // in place until the old pages settle; identity prevents it clearing a
    // newer request for the same key.
    request.then(
      () => {
        if (loadAllInFlightRef.current?.promise === request) loadAllInFlightRef.current = null;
      },
      () => {
        if (loadAllInFlightRef.current?.promise === request) loadAllInFlightRef.current = null;
      },
    );
    return request;
  }, [
    loadersRef,
    folderId,
    query,
    filter,
    accountScope,
    mailboxRefreshRef,
    folders,
    searchScope,
    messages,
  ]);

  return {
    messageLimit,
    setMessageLimit,
    hasMoreMessages,
    setHasMoreMessages,
    loadMoreStatus,
    loadMoreMessages,
    loadAllMessages,
  };
}
