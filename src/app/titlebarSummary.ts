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
  stats: MailStats | null,
  threadCount: number,
): string | undefined {
  if (listMode === 'messages') {
    return stats ? `${stats.total_messages} 封` : undefined;
  }
  return `${threadCount} 个会话`;
}
