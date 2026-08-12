import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  listSortStorageKey,
  loadListSort,
  messagePageSize,
} from '../app/appConfig';
import useMailboxLoadMore from './useMailboxLoadMore';
import useSavedSearches from './useSavedSearches';
import type {
  Account,
  AccountScope,
  FilterMode,
  Folder,
  ImapMailboxState,
  ListMode,
  ListSort,
  MessageSummary,
  SavedSearch,
  SearchScope,
  SyncRun,
  ThreadSummary,
} from '../app/types';

export type MailboxSearchLoaders = {
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
  ) => Promise<MessageSummary[]>;
  loadMessages: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
    refreshId?: number,
    nextLimit?: number,
    nextSearchScope?: SearchScope,
    nextIncludeThreads?: boolean,
  ) => Promise<MessageSummary[]>;
  loadMeta: (
    nextFolderId?: number | null,
    nextScope?: AccountScope,
    options?: { mode?: 'full' | 'mailbox' },
  ) => Promise<{ folderId: number | null; folders: Folder[] }>;
  syncImapHistoryPage: (accountId?: number) => Promise<SyncRun>;
};

type UseMailboxSearchControllerOptions = {
  account: Account | null;
  accountScope: AccountScope;
  folderId: number | null;
  folders: Folder[];
  imapMailboxes: ImapMailboxState[];
  messages: MessageSummary[];
  mailboxRefreshRef: MutableRefObject<number>;
  loadersRef: MutableRefObject<MailboxSearchLoaders | null>;
  setActiveThread: Dispatch<SetStateAction<ThreadSummary | null>>;
  setThreadMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useMailboxSearchController({
  account,
  accountScope,
  folderId,
  folders,
  imapMailboxes,
  messages,
  mailboxRefreshRef,
  loadersRef,
  setActiveThread,
  setThreadMessages,
  setStatus,
}: UseMailboxSearchControllerOptions) {
  const [query, setQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('folder');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [listMode, setListMode] = useState<ListMode>('messages');
  const [listSort, setListSort] = useState<ListSort>(loadListSort);
  const searchClearTimerRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // 搜索/范围/筛选/排序/清空都生成独立请求 token：自增 mailbox 世代后返回新值，
  // 使上一轮搜索的在途慢响应因 refreshId 不再匹配而失效，避免旧结果覆盖新结果。
  const nextSearchRefreshId = useCallback(() => {
    mailboxRefreshRef.current += 1;
    return mailboxRefreshRef.current;
  }, [mailboxRefreshRef]);

  useEffect(() => {
    window.localStorage.setItem(listSortStorageKey, listSort);
  }, [listSort]);

  const {
    savedSearches,
    setSavedSearches,
    savedSearchName,
    setSavedSearchName,
    saveCurrentSearch,
    deleteSavedSearch,
  } = useSavedSearches({ setStatus });

  const {
    messageLimit,
    setMessageLimit,
    hasMoreMessages,
    setHasMoreMessages,
    loadMoreStatus,
    loadMoreMessages,
  } = useMailboxLoadMore({
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
  });

  const runSearch = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const loaders = loadersRef.current;
    if (!loaders) return;
    await loaders.loadMessagesWithVisibleFallback(
      folderId,
      query,
      filter,
      accountScope,
      nextSearchRefreshId(),
      folders,
      messagePageSize,
      searchScope,
      listMode === 'threads',
    );
    setStatus(query.trim() ? `已搜索：${query.trim()}` : '已刷新搜索范围');
  }, [
    loadersRef,
    folderId,
    query,
    filter,
    accountScope,
    nextSearchRefreshId,
    folders,
    searchScope,
    listMode,
    setStatus,
  ]);

  const changeSearchScope = useCallback(async (nextScope: SearchScope) => {
    const loaders = loadersRef.current;
    if (!loaders) return;
    setSearchScope(nextScope);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loaders.loadMessagesWithVisibleFallback(
      folderId,
      query,
      filter,
      accountScope,
      nextSearchRefreshId(),
      folders,
      messagePageSize,
      nextScope,
      false,
    );
    const label = nextScope === 'folder' ? '当前文件夹' : nextScope === 'account' ? '当前账号' : '全部账号';
    setStatus(`搜索范围已切换为：${label}`);
  }, [
    loadersRef,
    folderId,
    query,
    filter,
    accountScope,
    nextSearchRefreshId,
    folders,
    setActiveThread,
    setThreadMessages,
    setStatus,
  ]);

  const applySearchShortcut = useCallback(async (shortcutQuery: string) => {
    const loaders = loadersRef.current;
    if (!loaders) return;
    const nextQuery = shortcutQuery.endsWith(':')
      ? `${query.trim()} ${shortcutQuery}`.trim()
      : shortcutQuery;
    setQuery(nextQuery);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loaders.loadMessagesWithVisibleFallback(
      folderId,
      nextQuery,
      filter,
      accountScope,
      nextSearchRefreshId(),
      folders,
      messagePageSize,
      searchScope,
      false,
    );
    searchInputRef.current?.focus();
    if (shortcutQuery.endsWith(':')) {
      searchInputRef.current?.setSelectionRange(nextQuery.length, nextQuery.length);
      setStatus(`已插入搜索条件：${shortcutQuery}`);
    } else {
      setStatus(`已搜索：${nextQuery}`);
    }
  }, [
    query,
    loadersRef,
    folderId,
    filter,
    accountScope,
    nextSearchRefreshId,
    folders,
    searchScope,
    setActiveThread,
    setThreadMessages,
    setStatus,
  ]);

  const clearSearchAndFilter = useCallback(async () => {
    const loaders = loadersRef.current;
    if (!loaders) return;
    setQuery('');
    setFilter('all');
    setSearchScope('folder');
    setActiveThread(null);
    setThreadMessages([]);
    await loaders.loadMessagesWithVisibleFallback(
      folderId,
      '',
      'all',
      accountScope,
      nextSearchRefreshId(),
      folders,
      messagePageSize,
      'folder',
      listMode === 'threads',
    );
    setStatus('已清空搜索和筛选');
  }, [
    loadersRef,
    folderId,
    accountScope,
    nextSearchRefreshId,
    folders,
    listMode,
    setActiveThread,
    setThreadMessages,
    setStatus,
  ]);


  const runSavedSearch = useCallback(async (savedSearch: SavedSearch) => {
    const loaders = loadersRef.current;
    if (!loaders) return;
    setQuery(savedSearch.query);
    setFilter(savedSearch.filter);
    setSearchScope(savedSearch.scope);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loaders.loadMessages(
      folderId,
      savedSearch.query,
      savedSearch.filter,
      accountScope,
      nextSearchRefreshId(),
      messagePageSize,
      savedSearch.scope,
      false,
    );
    setStatus(`已运行保存搜索：${savedSearch.name}`);
  }, [
    loadersRef,
    folderId,
    accountScope,
    nextSearchRefreshId,
    messagePageSize,
    setActiveThread,
    setThreadMessages,
    setStatus,
  ]);

  const resetSearch = useCallback(() => {
    setQuery('');
    setFilter('all');
    setSearchScope('folder');
    setListMode('messages');
  }, []);

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
    if (searchClearTimerRef.current !== null) {
      window.clearTimeout(searchClearTimerRef.current);
      searchClearTimerRef.current = null;
    }
    if (!val.trim()) {
      searchClearTimerRef.current = window.setTimeout(() => {
        searchClearTimerRef.current = null;
        const loaders = loadersRef.current;
        if (!loaders) return;
        loaders.loadMessagesWithVisibleFallback(
          folderId,
          '',
          filter,
          accountScope,
          nextSearchRefreshId(),
          folders,
          messagePageSize,
          searchScope,
          false,
        ).catch((error) => setStatus(String(error)));
      }, 100);
    }
  }, [loadersRef, folderId, filter, accountScope, nextSearchRefreshId, folders, searchScope, setStatus]);

  const handleSearchScopeChange = useCallback((nextScope: SearchScope) => {
    changeSearchScope(nextScope).catch((error) => setStatus(String(error)));
  }, [changeSearchScope, setStatus]);

  const handleClearSearchAndFilter = useCallback(() => {
    clearSearchAndFilter().catch((error) => setStatus(String(error)));
  }, [clearSearchAndFilter, setStatus]);

  const handleApplySearchShortcut = useCallback((nextQuery: string) => {
    applySearchShortcut(nextQuery).catch((error) => setStatus(String(error)));
  }, [applySearchShortcut, setStatus]);

  const handleShowMessages = useCallback(() => {
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
  }, [setActiveThread, setThreadMessages]);

  // 排序变更也是视图刷新：先自增世代使在途旧请求失效，再应用新排序并触发加载。
  const changeListSort = useCallback((nextSort: ListSort) => {
    mailboxRefreshRef.current += 1;
    setListSort(nextSort);
  }, [mailboxRefreshRef]);

  // 筛选变更同样生成独立请求 token：快速连续切换筛选时，旧筛选的在途响应
  // 不得覆盖新筛选的结果。兼容 Dispatch 语义（接受新值或更新函数）。
  const changeFilter = useCallback((nextFilter: SetStateAction<FilterMode>) => {
    mailboxRefreshRef.current += 1;
    setFilter(nextFilter);
  }, [mailboxRefreshRef]);

  const handleShowThreads = useCallback(() => {
    const loaders = loadersRef.current;
    if (!loaders) return;
    setListMode('threads');
    loaders.loadMessagesWithVisibleFallback(
      folderId,
      query,
      filter,
      accountScope,
      nextSearchRefreshId(),
      folders,
      messageLimit,
      searchScope,
      true,
    ).catch((error) => setStatus(String(error)));
  }, [
    loadersRef,
    folderId,
    query,
    filter,
    accountScope,
    nextSearchRefreshId,
    folders,
    messageLimit,
    searchScope,
    setStatus,
  ]);

  return {
    query,
    setQuery,
    searchScope,
    setSearchScope,
    filter,
    setFilter: changeFilter,
    listMode,
    setListMode,
    listSort,
    setListSort: changeListSort,
    savedSearches,
    setSavedSearches,
    savedSearchName,
    setSavedSearchName,
    messageLimit,
    setMessageLimit,
    hasMoreMessages,
    setHasMoreMessages,
    loadMoreStatus,
    searchInputRef,
    runSearch,
    changeSearchScope,
    applySearchShortcut,
    clearSearchAndFilter,
    loadMoreMessages,
    runSavedSearch,
    saveCurrentSearch,
    deleteSavedSearch,
    resetSearch,
    handleQueryChange,
    handleSearchScopeChange,
    handleClearSearchAndFilter,
    handleApplySearchShortcut,
    handleShowMessages,
    handleShowThreads,
  };
}
