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
import type { MailboxRefreshRequest } from './useAppMetaLoader';
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
import type { MailboxThreadLoader } from './useMailboxData';

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
    mailboxRequest?: MailboxRefreshRequest,
    nextOffset?: number,
    nextReturnPageOnly?: boolean,
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
    mailboxRequest?: MailboxRefreshRequest,
    nextOffset?: number,
    nextReturnPageOnly?: boolean,
  ) => Promise<MessageSummary[]>;
  loadThreads: MailboxThreadLoader;
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
  setSelectedMessageIds?: Dispatch<SetStateAction<number[]>>;
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
  setSelectedMessageIds,
  setStatus,
}: UseMailboxSearchControllerOptions) {
  const [queryState, setQueryState] = useState({
    queryDraft: '',
    appliedQuery: '',
  });
  const { queryDraft, appliedQuery } = queryState;
  const [searchScope, setSearchScope] = useState<SearchScope>('folder');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [listMode, setListMode] = useState<ListMode>('messages');
  const [listSort, setListSort] = useState<ListSort>(loadListSort);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Programmatic query changes are committed immediately because navigation,
  // saved searches and imports already represent explicit user actions. Text
  // entry uses handleQueryChange below and only changes the draft.
  const setQuery = useCallback<Dispatch<SetStateAction<string>>>((nextQuery) => {
    setQueryState((current) => {
      const resolvedQuery = typeof nextQuery === 'function'
        ? nextQuery(current.queryDraft)
        : nextQuery;
      if (
        current.queryDraft === resolvedQuery
        && current.appliedQuery === resolvedQuery
      ) {
        return current;
      }
      return {
        queryDraft: resolvedQuery,
        appliedQuery: resolvedQuery,
      };
    });
  }, []);

  const applyQuery = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
  }, [setQuery]);

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
    loadAllMessages,
  } = useMailboxLoadMore({
    account,
    accountScope,
    folderId,
    query: appliedQuery,
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
    setSelectedMessageIds?.([]);
    applyQuery(queryDraft);
    await loaders.loadMessagesWithVisibleFallback(
      folderId,
      queryDraft,
      filter,
      accountScope,
      nextSearchRefreshId(),
      folders,
      messagePageSize,
      searchScope,
      listMode === 'threads',
    );
    setStatus(queryDraft.trim() ? `已搜索：${queryDraft.trim()}` : '已刷新搜索范围');
  }, [
    loadersRef,
    folderId,
    queryDraft,
    filter,
    accountScope,
    nextSearchRefreshId,
    folders,
    searchScope,
    listMode,
    applyQuery,
    setSelectedMessageIds,
    setStatus,
  ]);

  const changeSearchScope = useCallback(async (nextScope: SearchScope) => {
    const loaders = loadersRef.current;
    if (!loaders) return;
    setSelectedMessageIds?.([]);
    setSearchScope(nextScope);
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
    await loaders.loadMessagesWithVisibleFallback(
      folderId,
      appliedQuery,
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
    appliedQuery,
    filter,
    accountScope,
    nextSearchRefreshId,
    folders,
    setActiveThread,
    setThreadMessages,
    setSelectedMessageIds,
    setStatus,
  ]);

  const applySearchShortcut = useCallback(async (shortcutQuery: string) => {
    const loaders = loadersRef.current;
    if (!loaders) return;
    setSelectedMessageIds?.([]);
    const nextQuery = shortcutQuery.endsWith(':')
      ? `${queryDraft.trim()} ${shortcutQuery}`.trim()
      : shortcutQuery;
    applyQuery(nextQuery);
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
    queryDraft,
    loadersRef,
    folderId,
    filter,
    accountScope,
    nextSearchRefreshId,
    folders,
    searchScope,
    applyQuery,
    setActiveThread,
    setThreadMessages,
    setSelectedMessageIds,
    setStatus,
  ]);

  const clearSearchAndFilter = useCallback(async (
    nextFilter: FilterMode = 'all',
    nextIncludeThreads = listMode === 'threads',
  ) => {
    const loaders = loadersRef.current;
    if (!loaders) return;
    setSelectedMessageIds?.([]);
    applyQuery('');
    setFilter(nextFilter);
    setSearchScope('folder');
    setActiveThread(null);
    setThreadMessages([]);
    // The clear button unmounts as soon as the query/filter state resets.
    // Move focus first so keyboard users do not fall back to document.body.
    searchInputRef.current?.focus({ preventScroll: true });
    await loaders.loadMessagesWithVisibleFallback(
      folderId,
      '',
      nextFilter,
      accountScope,
      nextSearchRefreshId(),
      folders,
      messagePageSize,
      'folder',
      nextIncludeThreads,
    );
    setStatus('已清空搜索和筛选');
  }, [
    loadersRef,
    folderId,
    accountScope,
    nextSearchRefreshId,
    folders,
    listMode,
    applyQuery,
    setActiveThread,
    setThreadMessages,
    setSelectedMessageIds,
    setStatus,
  ]);


  const runSavedSearch = useCallback(async (savedSearch: SavedSearch) => {
    const loaders = loadersRef.current;
    if (!loaders) return;
    setSelectedMessageIds?.([]);
    applyQuery(savedSearch.query);
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
    applyQuery,
    setActiveThread,
    setThreadMessages,
    setSelectedMessageIds,
    setStatus,
  ]);

  const resetSearch = useCallback(() => {
    setSelectedMessageIds?.([]);
    applyQuery('');
    setFilter('all');
    setSearchScope('folder');
    setListMode('messages');
  }, [applyQuery, setSelectedMessageIds]);

  const handleQueryChange = useCallback((val: string) => {
    setQueryState((current) => (
      current.queryDraft === val
        ? current
        : { ...current, queryDraft: val }
    ));
  }, []);

  const handleSearchScopeChange = useCallback((nextScope: SearchScope) => {
    changeSearchScope(nextScope).catch((error) => setStatus(String(error)));
  }, [changeSearchScope, setStatus]);

  const handleClearSearchAndFilter = useCallback(() => {
    clearSearchAndFilter().catch((error) => setStatus(String(error)));
  }, [clearSearchAndFilter, setStatus]);

  const handleClearSearchForFilter = useCallback((
    nextFilter: FilterMode,
    nextIncludeThreads = false,
  ) => {
    clearSearchAndFilter(nextFilter, nextIncludeThreads).catch((error) => setStatus(String(error)));
  }, [clearSearchAndFilter, setStatus]);

  const handleApplySearchShortcut = useCallback((nextQuery: string) => {
    applySearchShortcut(nextQuery).catch((error) => setStatus(String(error)));
  }, [applySearchShortcut, setStatus]);

  const handleShowMessages = useCallback(() => {
    // Invalidate only thread commits. Advancing mailboxRefreshRef here would
    // also stale an in-flight first message page and can leave the mail view
    // empty when the user switches back quickly.
    loadersRef.current?.loadThreads.invalidate?.();
    setListMode('messages');
    setActiveThread(null);
    setThreadMessages([]);
  }, [loadersRef, setActiveThread, setThreadMessages]);

  // 排序变更也是视图刷新：先自增世代使在途旧请求失效，再应用新排序并触发加载。
  const changeListSort = useCallback((nextSort: ListSort) => {
    mailboxRefreshRef.current += 1;
    setSelectedMessageIds?.([]);
    setListSort(nextSort);
  }, [mailboxRefreshRef, setSelectedMessageIds]);

  // 筛选变更同样生成独立请求 token：快速连续切换筛选时，旧筛选的在途响应
  // 不得覆盖新筛选的结果。兼容 Dispatch 语义（接受新值或更新函数）。
  const changeFilter = useCallback((nextFilter: SetStateAction<FilterMode>) => {
    mailboxRefreshRef.current += 1;
    setSelectedMessageIds?.([]);
    setFilter(nextFilter);
  }, [mailboxRefreshRef, setSelectedMessageIds]);

  const handleShowThreads = useCallback(() => {
    const loaders = loadersRef.current;
    if (!loaders?.loadThreads) return;
    setSelectedMessageIds?.([]);
    setListMode('threads');
    loaders.loadThreads(
      folderId,
      appliedQuery,
      filter,
      accountScope,
      mailboxRefreshRef.current,
      searchScope,
    ).catch((error) => setStatus(String(error)));
  }, [
    loadersRef,
    folderId,
    appliedQuery,
    filter,
    accountScope,
    mailboxRefreshRef,
    searchScope,
    setSelectedMessageIds,
    setStatus,
  ]);

  return {
    queryDraft,
    appliedQuery,
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
    loadAllMessages,
    runSavedSearch,
    saveCurrentSearch,
    deleteSavedSearch,
    resetSearch,
    handleQueryChange,
    handleSearchScopeChange,
    handleClearSearchAndFilter,
    handleClearSearchForFilter,
    handleApplySearchShortcut,
    handleShowMessages,
    handleShowThreads,
  };
}
