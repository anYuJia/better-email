import type { AccountScope, FilterMode, ListMode } from './types';

export type MailboxContextKeyInput = {
  accountScope: AccountScope;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  listMode: ListMode;
};

/**
 * Derives a stable key for the current mailbox list context.
 *
 * The reader message detail cache is scoped to this key: when the mailbox
 * context changes (account, folder, search, filter or list mode) the cached
 * detail for the selected message must be refreshed even if the selected
 * message id did not change.
 */
export function buildMailboxContextKey(input: MailboxContextKeyInput): string {
  return [
    String(input.accountScope),
    input.folderId === null || input.folderId === undefined ? '' : String(input.folderId),
    input.query.trim().toLowerCase(),
    input.filter,
    input.listMode,
  ].join('|');
}
