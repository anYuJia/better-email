import type {
  AccountScope,
  FilterMode,
  Folder,
  ImapMailboxState,
  ListSort,
  SearchScope,
} from '../app/types';
import { flowInfo, flowWarn } from '../app/logger';

export type MailboxRequestArgs = {
  accountId: number | null;
  folderId: number | null;
  query: string | null;
  filter: FilterMode;
  sort: ListSort;
  limit: number;
};

export type MailboxRequests = {
  messages: MailboxRequestArgs;
  threads: MailboxRequestArgs;
};

export function mailboxFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('mailbox-flow', event, details);
}

export function mailboxFlowWarn(event: string, details: Record<string, unknown> = {}) {
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

export function checkHistoryIncomplete(
  folderId: number | null,
  accountScope: AccountScope,
  currentAccountId: number | null,
  folders: Folder[],
  imapMailboxes: ImapMailboxState[]
): boolean {
  if (!imapMailboxes || imapMailboxes.length === 0) return false;
  const folder = folders.find((f) => f.id === folderId);
  const targetAccountId = accountScope === 'all' ? null : currentAccountId;
  const scopeMailboxes = targetAccountId
    ? imapMailboxes.filter((m) => m.account_id === targetAccountId)
    : imapMailboxes;

  if (folder) {
    if (folder.is_virtual) {
      return scopeMailboxes.some((m) => m.local_role === folder.role && !m.history_complete);
    } else {
      return scopeMailboxes.some((m) => m.local_folder_id === folder.id && !m.history_complete);
    }
  }
  return scopeMailboxes.some((m) => !m.history_complete);
}
