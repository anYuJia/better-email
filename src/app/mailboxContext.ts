import type { AccountScope, FilterMode, ListMode } from './types';

export type MailboxContextKeyInput = {
  accountScope: AccountScope;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  listMode?: ListMode;
};

/**
 * Derives a stable key for the current mailbox list context.
 *
 * The reader message detail cache is scoped to this key: when the mailbox
 * data context changes (account, folder, search or filter) the cached detail
 * for the selected message must be refreshed even if the selected message
 * id did not change. Switching between messages and threads is
 * presentation-only and must not discard the reader cache or force another
 * detail query.
 */
export function buildMailboxContextKey(input: MailboxContextKeyInput): string {
  return [
    String(input.accountScope),
    input.folderId === null || input.folderId === undefined ? '' : String(input.folderId),
    input.query.trim().toLowerCase(),
    input.filter,
  ].join('|');
}
