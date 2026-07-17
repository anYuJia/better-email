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
