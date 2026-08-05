/**
 * Message detail reader utilities — extracted from App.tsx for testability.
 */

import type { Message } from '../app/types';

/** Metadata fields shared by Message and MessageSummary (no body/html). */
export type MessageMetadataPatch = Partial<
  Pick<
    Message,
    | 'is_read'
    | 'is_starred'
    | 'labels'
    | 'folder_id'
    | 'folder_role'
    | 'snoozed_until'
    | 'subject'
    | 'snippet'
    | 'security_warnings'
    | 'has_attachments'
    | 'attachment_count'
    | 'remote_mailbox'
    | 'remote_uid'
  >
>;

export function applyMessageMetadataPatch<T extends { id: number }>(
  message: T,
  patch: MessageMetadataPatch,
): T {
  return { ...message, ...patch, id: message.id };
}

export function resolveReaderSelectedDetail(
  selectedDetail: Message | null,
  readerSelectedId: number | null,
): Message | null {
  if (!selectedDetail || readerSelectedId == null) return null;
  return selectedDetail.id === readerSelectedId ? selectedDetail : null;
}

/**
 * Generate a single-character fallback initial for a sender avatar.
 * - Uses name first, then email, then '?' as fallback.
 * - English letters uppercase.
 * - CJK / Unicode characters kept as-is.
 * - Emoji-safe via Array.from().
 */
export function senderInitial(name?: string | null, email?: string | null): string {
  const source = (name && name.trim()) || (email && email.trim()) || '?';
  const first = Array.from(source)[0] || '?';
  return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : first;
}

/**
 * Stable avatar tone index (0-5) derived from the sender identity.
 * The same sender always maps to the same tone, independent of message id.
 */
export function senderAvatarTone(name?: string | null, email?: string | null): number {
  const source = ((name && name.trim()) || (email && email.trim()) || '?').toLowerCase();
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) >>> 0;
  }
  return hash % 6;
}
