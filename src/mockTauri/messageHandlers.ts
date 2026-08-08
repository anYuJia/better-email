import type { InvokeArgs, MockCommandHandler } from './types';
import {
  messages,
  labels,
  outbox,
  mutedThreadScopes,
  listMessages,
  listThreadMessages,
  listThreads,
  stats,
  refreshLabelCounts,
  releaseDueSnoozedMessages,
  setMockMessageRead,
  markMockFolderRead,
  setMockMessageStarred,
  moveMockMessageToRole,
  restoreMockMessageToInbox,
  deleteMockMessagePermanently,
  emptyMockTrash,
  snoozeMockMessage,
  unsnoozeMockMessage,
  applyMockLabelToMessage,
  removeMockLabelFromMessage,
  createMockLabel,
  updateMockLabel,
  deleteMockLabel,
  saveMockDraft,
  sendMockMessage,
  queueMockOutboxMessage,
  cancelMockOutboxItem,
  flushMockOutboxDryRun,
  releaseMockDueOutboxItems,
  flushMockOutboxSmtp,
  fetchMockMessageBody,
  renderMessageWithPolicy,
} from './state';
import { messageThreadKey, mutedThreadScopeKey } from './utils';

function setThreadsMuted(args?: InvokeArgs) {
  const messageIds = Array.isArray(args?.messageIds ?? args?.message_ids)
    ? (args?.messageIds ?? args?.message_ids) as number[]
    : [];
  const muted = Boolean(args?.muted);
  const scopes = new Set(
    messages
      .filter((message) => messageIds.includes(message.id))
      .map((message) => mutedThreadScopeKey(message.account_id, messageThreadKey(message))),
  );
  for (const scope of scopes) {
    if (muted) mutedThreadScopes.add(scope);
    else mutedThreadScopes.delete(scope);
  }
  return scopes.size;
}

function listMutedThreadKeys(args?: InvokeArgs) {
  const accountId = Number(args?.accountId ?? args?.account_id ?? 0);
  return [...new Set(
    messages
      .filter((message) => (
        message.account_id === accountId
        && mutedThreadScopes.has(mutedThreadScopeKey(accountId, messageThreadKey(message)))
      ))
      .map(messageThreadKey),
  )];
}

function listProviderWriteValidationMessages(args?: InvokeArgs) {
  const accountId = Number(args?.accountId ?? 0);
  const validationId = String(args?.validationId ?? '').trim().toLowerCase();
  return messages
    .filter((message) => accountId <= 0 || message.account_id === accountId)
    .filter((message) => validationId && message.subject.toLowerCase().includes(validationId))
    .sort((left, right) =>
      right.received_at.localeCompare(left.received_at) || right.id - left.id)
    .slice(0, 20);
}

export const handlers: Record<string, MockCommandHandler> = {
  'list_messages': (args) => listMessages(args),
  'list_thread_messages': (args) => listThreadMessages(args),
  'list_threads': (args) => listThreads(args),
  'list_provider_write_validation_messages': listProviderWriteValidationMessages,
  'set_threads_muted': setThreadsMuted,
  'list_muted_thread_keys': listMutedThreadKeys,
  'get_stats': (args) => stats(args),
  'list_labels': () => {
    refreshLabelCounts();
    return labels;
  },
  'list_outbox': () => outbox,
  'get_message_detail': (args) => {
    const message = messages.find((item) => item.id === args?.messageId);
    if (!message) return undefined;
    return renderMessageWithPolicy(message.id, false);
  },
  'set_message_read': setMockMessageRead,
  'mark_folder_read': markMockFolderRead,
  'set_message_starred': setMockMessageStarred,
  'move_message_to_role': moveMockMessageToRole,
  'restore_message_to_inbox': restoreMockMessageToInbox,
  'delete_message_permanently': deleteMockMessagePermanently,
  'empty_trash': emptyMockTrash,
  'snooze_message': snoozeMockMessage,
  'unsnooze_message': unsnoozeMockMessage,
  'release_due_snoozed_messages': (args) => releaseDueSnoozedMessages(String(args?.now ?? '')),
  'apply_label_to_message': applyMockLabelToMessage,
  'remove_label_from_message': removeMockLabelFromMessage,
  'create_label': createMockLabel,
  'update_label': updateMockLabel,
  'delete_label': deleteMockLabel,
  'save_draft': saveMockDraft,
  'send_message': sendMockMessage,
  'queue_outbox_message': queueMockOutboxMessage,
  'cancel_outbox_item': cancelMockOutboxItem,
  'flush_outbox_dry_run': flushMockOutboxDryRun,
  'release_due_outbox_items': releaseMockDueOutboxItems,
  'flush_outbox_smtp': flushMockOutboxSmtp,
  'fetch_message_body': fetchMockMessageBody,
};
