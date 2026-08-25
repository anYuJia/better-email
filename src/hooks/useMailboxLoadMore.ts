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

// The native list command clamps a request to 200 rows. This is large enough
// to make “全选” cover the complete local result set without rendering a
// second selection model for unloaded rows.
const SELECT_ALL_MESSAGE_LIMIT = 200;

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

  const loadMoreMessages = useCallback(async () => {
    const loaders = loadersRef.current;
    if (!loaders) return messages;
    if (loadingMoreRef.current) return messages;
    loadingMoreRef.current = true;
    // 捕获发起时的 mailbox 世代：加载更多期间用户导航到别的视图时，
    // 慢响应不得把旧文件夹的追加结果写回新视图。
    const startedRefreshId = mailboxRefreshRef.current;
    setLoadMoreStatus('正在读取本地缓存...');
    try {
      const nextLimit = messageLimit + messagePageSize;
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
      );
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

      if (nextMessages.length <= messages.length && targetMailbox) {
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
        );
        setStatus(`${run.message} · 已显示 ${refreshedMessages.length} 封邮件`);
        return refreshedMessages;
      } else {
        setStatus(`已加载 ${nextMessages.length} 封邮件`);
        return nextMessages;
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadMoreStatus(null);
    }
  }, [
    loadersRef,
    messageLimit,
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

  const loadAllMessages = useCallback(async () => {
    const loaders = loadersRef.current;
    if (!loaders) return messages;
    if (loadingMoreRef.current) return messages;
    loadingMoreRef.current = true;
    const startedRefreshId = mailboxRefreshRef.current;
    setLoadMoreStatus('正在读取全部邮件...');
    try {
      return await loaders.loadMessagesWithVisibleFallback(
        folderId,
        query,
        filter,
        accountScope,
        startedRefreshId,
        folders,
        Math.max(messageLimit, SELECT_ALL_MESSAGE_LIMIT),
        searchScope,
        false,
      );
    } finally {
      loadingMoreRef.current = false;
      setLoadMoreStatus(null);
    }
  }, [
    loadersRef,
    messageLimit,
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
