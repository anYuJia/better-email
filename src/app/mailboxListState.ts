import type { AccountScope, FilterMode, ListSort, SearchScope } from './types';
import { messagePageSize } from './appConfig';

export const mailboxListStateStorageKey = 'better-email.mailboxListState.v1';

type MailboxListState = {
  limit?: number;
  scrollTop?: number;
  updatedAt: number;
};

type MailboxListStatePatch = Omit<Partial<MailboxListState>, 'updatedAt'>;

export function clampMessageLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return messagePageSize;
  return Math.min(Math.max(Math.trunc(value), messagePageSize), messagePageSize * 20);
}

export function buildMailboxListStateKey({
  accountScope,
  folderId,
  query,
  filter,
  searchScope,
  listSort,
}: {
  accountScope: AccountScope;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  searchScope: SearchScope;
  listSort: ListSort;
}): string {
  return [
    `scope=${accountScope}`,
    `folder=${folderId ?? 'none'}`,
    `searchScope=${searchScope}`,
    `query=${query.trim().toLowerCase()}`,
    `filter=${filter}`,
    `sort=${listSort}`,
  ].join('|');
}

export function loadMailboxListStates(): Record<string, MailboxListState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(mailboxListStateStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, MailboxListState>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveMailboxListState(key: string, patch: MailboxListStatePatch): void {
  if (typeof window === 'undefined' || !key) return;
  try {
    const states = loadMailboxListStates();
    const next = {
      ...states,
      [key]: {
        ...states[key],
        ...patch,
        updatedAt: Date.now(),
      },
    };
    const entries = Object.entries(next)
      .sort(([, left], [, right]) => (right.updatedAt || 0) - (left.updatedAt || 0))
      .slice(0, 80);
    window.localStorage.setItem(mailboxListStateStorageKey, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // List state is a convenience cache; storage failures should never block mailbox rendering.
  }
}

export function loadMailboxMessageLimit(key: string): number {
  const saved = loadMailboxListStates()[key]?.limit;
  return clampMessageLimit(saved);
}
