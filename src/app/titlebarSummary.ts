import type { ListMode, MailStats } from './types';

/**
 * Formats the compact summary shown beside the current mailbox name.
 *
 * `MailStats.total_messages` is scoped to the active account scope and is
 * independent of the selected folder. A loaded message list is only the
 * current folder (and may also be paginated), so it must never be used as a
 * fallback for this account-wide total.
 */
export function buildTitlebarViewSummary(
  listMode: ListMode,
  _stats: MailStats | null,
  threadCount: number,
  messageCount: number | null = null,
): string | undefined {
  if (listMode === 'messages') {
    // The title bar must follow the selected folder/search scope. stats is
    // account-wide and includes folders that are not present in the list.
    return messageCount === null ? undefined : `${messageCount} 封`;
  }
  return `${threadCount} 个会话`;
}
