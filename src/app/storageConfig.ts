import type {
  AccountScope,
  AppLayout,
  BackgroundTaskKind,
  FilterMode,
  ProviderVerificationRecord,
  SavedSearch,
  SearchScope,
} from './types';
import type { ListSort } from './types';

export const notificationPolicyStorageKey = 'better-email.notificationPolicy';
export const providerVerificationStorageKey = 'better-email.providerVerifications';
export const savedSearchesStorageKey = 'better-email.savedSearches';
export const composeTemplatesStorageKey = 'better-email.composeTemplates';
export const composerAutosaveStorageKey = 'better-email.composerAutosave';
export const appLayoutStorageKey = 'better-email.appLayout.v2';
export const legacyAppLayoutStorageKey = 'swiftmail.appLayout.v2';
export const sendUndoDelayStorageKey = 'better-email.sendUndoDelaySeconds';
export const favoriteFolderKeysStorageKey = 'better-email.favoriteFolderKeys.v1';
export const listSortStorageKey = 'better-email.listSort.v1';
export const accountScopeStorageKey = 'better-email.accountScope.v1';

const legacyStorageKeyByCurrent: Record<string, string> = {
  [notificationPolicyStorageKey]: 'swiftmail.notificationPolicy',
  [providerVerificationStorageKey]: 'swiftmail.providerVerifications',
  [savedSearchesStorageKey]: 'swiftmail.savedSearches',
  [composeTemplatesStorageKey]: 'swiftmail.composeTemplates',
  [composerAutosaveStorageKey]: 'swiftmail.composerAutosave',
  [appLayoutStorageKey]: legacyAppLayoutStorageKey,
  [sendUndoDelayStorageKey]: 'swiftmail.sendUndoDelaySeconds',
  [favoriteFolderKeysStorageKey]: 'swiftmail.favoriteFolderKeys.v1',
  [listSortStorageKey]: 'swiftmail.listSort.v1',
};

/*
 * Desktop pane defaults follow the reference composition as a ratio of the
 * available window, rather than carrying the old fixed 236/388 split into
 * every viewport. The clamp range leaves room for manual resizing while
 * keeping the first render balanced at the supported desktop widths.
 */
export const appLayoutBounds = {
  sidebar: { min: 218, max: 320 },
  // Keep the persisted/manual resize floor compatible with existing layouts;
  // responsive defaults still land at 448px (1280) and 512px (1440).
  list: { min: 340, max: 560 },
} as const;

export function getDefaultAppLayout(viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth): AppLayout {
  const width = Number.isFinite(viewportWidth) ? viewportWidth : 1440;
  return {
    sidebar: clampNumber(Math.round(width * 0.1375 + 48), 218, 252),
    list: clampNumber(Math.round(width * 0.4 - 64), 430, 525),
  };
}

/* Stable desktop reference for callers that need a serialisable fallback. */
export const defaultAppLayout: AppLayout = getDefaultAppLayout(1440);
export const filterModes: FilterMode[] = ['all', 'unread', 'starred', 'attachments'];
export const listSortModes: ListSort[] = ['newest', 'oldest', 'sender', 'subject'];
export const listSortOptions: { id: ListSort; label: string }[] = [
  { id: 'newest', label: '最新优先' },
  { id: 'oldest', label: '最早优先' },
  { id: 'sender', label: '发件人 / 参与者' },
  { id: 'subject', label: '主题 A-Z' },
];

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function backgroundTaskTitle(kind: BackgroundTaskKind, source: 'manual' | 'timer' | 'initial' = 'manual'): string {
  if (kind === 'sync') {
    if (source === 'initial') return '首次同步邮件头';
    return source === 'manual' ? '手动同步全部邮箱' : '定时同步全部邮箱';
  }
  if (kind === 'outbox-dry-run') return source === 'manual' ? '手动演练发件箱发送' : '定时演练发件箱发送';
  return source === 'manual' ? '手动发送发件箱邮件' : '定时发送发件箱邮件';
}

export function readAppStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  const current = window.localStorage.getItem(key);
  if (current != null) return current;
  const legacyKey = legacyStorageKeyByCurrent[key];
  if (!legacyKey) return null;
  const legacy = window.localStorage.getItem(legacyKey);
  if (legacy == null) return null;
  window.localStorage.setItem(key, legacy);
  window.localStorage.removeItem(legacyKey);
  return legacy;
}

export function removeAppStorage(key: string): void {
  window.localStorage.removeItem(key);
  const legacyKey = legacyStorageKeyByCurrent[key];
  if (legacyKey) window.localStorage.removeItem(legacyKey);
}

export function isFilterMode(value: unknown): value is FilterMode {
  return typeof value === 'string' && filterModes.includes(value as FilterMode);
}

export function isSearchScope(value: unknown): value is SearchScope {
  return value === 'folder' || value === 'account' || value === 'all';
}

export function isListSort(value: unknown): value is ListSort {
  return typeof value === 'string' && listSortModes.includes(value as ListSort);
}

export function loadAccountScope(): AccountScope {
  try {
    const stored = readAppStorage(accountScopeStorageKey);
    if (stored === 'all') return 'all';
    const id = Number(stored);
    if (Number.isInteger(id) && id > 0) return id;
    return 'all';
  } catch {
    return 'all';
  }
}

export function loadListSort(): ListSort {
  try {
    const stored = readAppStorage(listSortStorageKey);
    return isListSort(stored) ? stored : 'newest';
  } catch {
    return 'newest';
  }
}

export function loadFavoriteFolderKeys(): string[] {
  try {
    const raw = readAppStorage(favoriteFolderKeysStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0))]
      : [];
  } catch {
    return [];
  }
}

export function loadProviderVerifications(): Record<string, ProviderVerificationRecord> {
  try {
    const stored = readAppStorage(providerVerificationStorageKey);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function loadSavedSearches(): SavedSearch[] {
  try {
    const stored = readAppStorage(savedSearchesStorageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string' && typeof item.query === 'string')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : crypto.randomUUID(),
        name: item.name,
        query: item.query,
        filter: isFilterMode(item.filter) ? item.filter : 'all',
        scope: isSearchScope(item.scope) ? item.scope : 'folder',
      }))
      .filter((item) => item.name.trim() && item.query.trim());
  } catch {
    return [];
  }
}

export function loadAppLayout(): AppLayout {
  try {
    const responsiveDefault = getDefaultAppLayout();
    const stored = readAppStorage(appLayoutStorageKey);
    if (!stored) return responsiveDefault;
    const parsed = JSON.parse(stored);
    const sidebar = Number(parsed.sidebar);
    const list = Number(parsed.list);
    if (sidebar === 236 && list === 388) {
      return responsiveDefault;
    }
    return {
      sidebar: clampNumber(Number.isFinite(sidebar) ? sidebar : responsiveDefault.sidebar, appLayoutBounds.sidebar.min, appLayoutBounds.sidebar.max),
      list: clampNumber(Number.isFinite(list) ? list : responsiveDefault.list, appLayoutBounds.list.min, appLayoutBounds.list.max),
    };
  } catch {
    return getDefaultAppLayout();
  }
}
