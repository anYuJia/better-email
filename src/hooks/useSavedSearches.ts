import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  loadSavedSearches,
  savedSearchesStorageKey,
} from '../app/appConfig';
import type { FilterMode, SavedSearch, SearchScope } from '../app/types';

type SavedSearchesOptions = {
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useSavedSearches({ setStatus }: SavedSearchesOptions) {
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(loadSavedSearches);
  const [savedSearchName, setSavedSearchName] = useState('');

  useEffect(() => {
    window.localStorage.setItem(savedSearchesStorageKey, JSON.stringify(savedSearches));
  }, [savedSearches]);

  const saveCurrentSearch = useCallback((query: string, filter: FilterMode, scope: SearchScope) => {
    const trimmedQuery = query.trim();
    const trimmedName = savedSearchName.trim() || trimmedQuery;
    if (!trimmedQuery) {
      setStatus('请输入搜索条件后再保存');
      return;
    }
    setSavedSearches((current) => {
      const withoutDuplicate = current.filter(
        (item) => item.name !== trimmedName
          && !(item.query === trimmedQuery && item.filter === filter && item.scope === scope),
      );
      return [
        ...withoutDuplicate,
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          query: trimmedQuery,
          filter,
          scope,
        },
      ];
    });
    setSavedSearchName('');
    setStatus(`已保存搜索：${trimmedName}`);
  }, [savedSearchName, setStatus]);

  const deleteSavedSearch = useCallback((savedSearch: SavedSearch) => {
    setSavedSearches((current) => current.filter((item) => item.id !== savedSearch.id));
    setStatus(`已删除保存搜索：${savedSearch.name}`);
  }, [setStatus]);

  return {
    savedSearches,
    setSavedSearches,
    savedSearchName,
    setSavedSearchName,
    saveCurrentSearch,
    deleteSavedSearch,
  };
}
