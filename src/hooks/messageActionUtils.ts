import type {
  FolderRole,
  Label,
  MessageSummary,
} from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

export type MessageActionContext = 'bulk' | 'thread';

export function uniqueMessages(items: MessageSummary[]) {
  return [...new Map(items.map((message) => [message.id, message])).values()];
}

export function threadMovableMessages(items: MessageSummary[]) {
  return items.filter(
    (message) => !['drafts', 'outbox', 'sent'].includes(message.folder_role),
  );
}

export async function moveMessagesToRole(messages: MessageSummary[], role: FolderRole) {
  for (const message of messages) {
    await invoke(IPC.MoveMessageToRole, { messageId: message.id, role });
  }
}

export async function setMessagesRead(messages: MessageSummary[], isRead: boolean) {
  for (const message of messages) {
    await invoke(IPC.SetMessageRead, { messageId: message.id, isRead });
  }
}

export async function setMessagesStarred(messages: MessageSummary[], isStarred: boolean) {
  for (const message of messages) {
    await invoke(IPC.SetMessageStarred, { messageId: message.id, isStarred });
  }
}

export async function toggleMessagesLabel(
  messages: MessageSummary[],
  label: Label,
  shouldRemove: boolean,
) {
  for (const message of messages) {
    const hasLabel = message.labels.includes(label.name);
    if (shouldRemove ? hasLabel : !hasLabel) {
      await invoke(
        shouldRemove ? 'remove_label_from_message' : 'apply_label_to_message',
        {
          messageId: message.id,
          labelId: label.id,
        },
      );
    }
  }
}

export function crossAccountBlockReason(messages: MessageSummary[]): string | null {
  const accountCount = new Set(messages.map((message) => message.account_id)).size;
  return accountCount > 1 ? '不同账号的邮件不能移动到同一文件夹' : null;
}
