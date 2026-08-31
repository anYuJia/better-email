import { canSnoozeRole } from './snooze';
import type { FolderRole, MessageSummary, UndoMessageSnapshot } from './types';

export type BulkMessageAction =
  | 'archive'
  | 'star'
  | 'unstar'
  | 'trash'
  | 'read'
  | 'unread'
  | 'spam'
  | 'not-spam'
  | 'restore'
  | 'unsnooze'
  | 'permanent-delete';

export type MessageCollectionScope = 'bulk' | 'thread';
export type MessageCollectionEntryAction = BulkMessageAction | 'snooze';
export type MessageCollectionEntryGroup = 'status' | 'organize' | 'danger';

export type MessageCollectionActionEntry = {
  action: MessageCollectionEntryAction;
  label: string;
  messages: MessageSummary[];
  group: MessageCollectionEntryGroup;
  danger?: boolean;
  shortcut?: string;
};

export type MessageCollectionActionState = {
  messages: MessageSummary[];
  totalCount: number;
  allRead: boolean;
  allStarred: boolean;
  entries: MessageCollectionActionEntry[];
};

const archiveBlockedRoles = new Set<FolderRole>([
  'archive',
  'drafts',
  'outbox',
  'sent',
  'spam',
  'trash',
]);
const spamBlockedRoles = new Set<FolderRole>([
  'drafts',
  'outbox',
  'sent',
  'spam',
  'trash',
]);

export function uniqueMessageSummaries(items: MessageSummary[]) {
  return [...new Map(items.map((message) => [message.id, message])).values()];
}

export function snapshotMessageSummaries(items: MessageSummary[]): UndoMessageSnapshot[] {
  return items.map((message) => ({
    id: message.id,
    subject: message.subject || '(无主题)',
    account_id: message.account_id,
    folder_role: message.folder_role,
    is_read: message.is_read,
    is_starred: message.is_starred,
    snoozed_until: message.snoozed_until,
    labels: [...message.labels],
  }));
}

export function canReplyToMessageRole(role: FolderRole) {
  return role !== 'drafts' && role !== 'outbox';
}

export function canChangeMessageReadStateRole(role: FolderRole) {
  return role !== 'drafts' && role !== 'outbox';
}

export function canArchiveMessageRole(role: FolderRole) {
  return !archiveBlockedRoles.has(role);
}

export function canMarkMessageAsSpamRole(role: FolderRole) {
  return !spamBlockedRoles.has(role);
}

export function canMoveMessageToTrashRole(role: FolderRole) {
  return role !== 'trash';
}

export function messagesForCollectionAction(
  items: MessageSummary[],
  action: BulkMessageAction,
  scope: MessageCollectionScope = 'bulk',
) {
  const messages = uniqueMessageSummaries(items);

  switch (action) {
    case 'read':
      return messages.filter((message) => (
        canChangeMessageReadStateRole(message.folder_role) && !message.is_read
      ));
    case 'unread':
      return messages.filter((message) => (
        canChangeMessageReadStateRole(message.folder_role) && message.is_read
      ));
    case 'star':
      return messages.filter((message) => !message.is_starred);
    case 'unstar':
      return messages.filter((message) => message.is_starred);
    case 'archive':
      return messages.filter((message) => canArchiveMessageRole(message.folder_role));
    case 'trash':
      return messages.filter((message) => (
        canMoveMessageToTrashRole(message.folder_role)
        && (scope !== 'thread' || !['drafts', 'outbox'].includes(message.folder_role))
      ));
    case 'spam':
      return messages.filter((message) => canMarkMessageAsSpamRole(message.folder_role));
    case 'not-spam':
      return messages.filter((message) => message.folder_role === 'spam');
    case 'restore':
    case 'permanent-delete':
      return messages.filter((message) => message.folder_role === 'trash');
    case 'unsnooze':
      return messages.filter((message) => message.folder_role === 'snoozed');
  }
}

export function messageCollectionActionLabel(action: MessageCollectionEntryAction) {
  switch (action) {
    case 'read': return '标为已读';
    case 'unread': return '标为未读';
    case 'star': return '添加星标';
    case 'unstar': return '取消星标';
    case 'snooze': return '稍后处理';
    case 'unsnooze': return '取消稍后处理';
    case 'archive': return '归档';
    case 'restore': return '恢复到收件箱';
    case 'spam': return '标为垃圾邮件';
    case 'not-spam': return '不是垃圾邮件';
    case 'trash': return '移到废纸篓';
    case 'permanent-delete': return '永久删除';
  }
}

function entry(
  action: MessageCollectionEntryAction,
  messages: MessageSummary[],
  group: MessageCollectionEntryGroup,
  options: Pick<MessageCollectionActionEntry, 'danger' | 'shortcut'> = {},
): MessageCollectionActionEntry {
  return {
    action,
    label: messageCollectionActionLabel(action),
    messages,
    group,
    ...options,
  };
}

export function buildMessageCollectionActionState(
  items: MessageSummary[],
  scope: MessageCollectionScope = 'bulk',
): MessageCollectionActionState {
  const messages = uniqueMessageSummaries(items);
  const totalCount = messages.length;
  const readableMessages = messages.filter((message) => canChangeMessageReadStateRole(message.folder_role));
  const allRead = readableMessages.length > 0 && readableMessages.every((message) => message.is_read);
  const allStarred = totalCount > 0 && messages.every((message) => message.is_starred);
  const readAction: BulkMessageAction = allRead ? 'unread' : 'read';
  const starAction: BulkMessageAction = allStarred ? 'unstar' : 'star';
  const snoozableMessages = messages.filter((message) => canSnoozeRole(message.folder_role));
  const unsnoozableMessages = messagesForCollectionAction(messages, 'unsnooze', scope);
  const restoreMessages = messagesForCollectionAction(messages, 'restore', scope);
  const notSpamMessages = messagesForCollectionAction(messages, 'not-spam', scope);
  const archiveMessages = messagesForCollectionAction(messages, 'archive', scope);
  const spamMessages = messagesForCollectionAction(messages, 'spam', scope);
  const trashMessages = messagesForCollectionAction(messages, 'trash', scope);
  const permanentDeleteMessages = messagesForCollectionAction(messages, 'permanent-delete', scope);
  const entries: MessageCollectionActionEntry[] = [];

  if (readableMessages.length > 0) {
    entries.push(entry(
      readAction,
      messagesForCollectionAction(messages, readAction, scope),
      'status',
      { shortcut: 'M' },
    ));
  }
  if (totalCount > 0) {
    entries.push(entry(
      starAction,
      messagesForCollectionAction(messages, starAction, scope),
      'status',
      { shortcut: 'S' },
    ));
  }
  if (unsnoozableMessages.length > 0) {
    entries.push(entry('unsnooze', unsnoozableMessages, 'organize'));
  }
  if (snoozableMessages.length > 0) {
    entries.push(entry('snooze', snoozableMessages, 'organize'));
  }
  if (restoreMessages.length > 0) {
    entries.push(entry('restore', restoreMessages, 'organize'));
  }
  if (notSpamMessages.length > 0) {
    entries.push(entry('not-spam', notSpamMessages, 'organize'));
  }
  if (archiveMessages.length > 0) {
    entries.push(entry('archive', archiveMessages, 'organize', { shortcut: 'E' }));
  }
  if (spamMessages.length > 0) {
    entries.push(entry('spam', spamMessages, 'organize'));
  }
  if (trashMessages.length > 0) {
    entries.push(entry('trash', trashMessages, 'danger', { danger: true }));
  }
  if (permanentDeleteMessages.length > 0) {
    entries.push(entry('permanent-delete', permanentDeleteMessages, 'danger', { danger: true }));
  }

  return { messages, totalCount, allRead, allStarred, entries };
}

export function collectionActionDetail(targetCount: number, totalCount: number) {
  return targetCount === totalCount
    ? `${targetCount} 封邮件`
    : `${targetCount}/${totalCount} 封可处理`;
}

export function primaryMessageCollectionActions(state: MessageCollectionActionState) {
  const byAction = new Map(state.entries.map((item) => [item.action, item]));
  const appliesToAll = (action: MessageCollectionEntryAction) => {
    const candidate = byAction.get(action);
    return candidate && candidate.messages.length === state.totalCount ? candidate : null;
  };
  const primary: MessageCollectionActionEntry[] = [];

  const stateSpecific = appliesToAll('restore')
    ?? appliesToAll('not-spam')
    ?? appliesToAll('unsnooze')
    ?? byAction.get('archive')
    ?? byAction.get('restore')
    ?? byAction.get('not-spam')
    ?? byAction.get('unsnooze');
  if (stateSpecific) primary.push(stateSpecific);

  const destructive = appliesToAll('permanent-delete')
    ?? byAction.get('trash')
    ?? byAction.get('permanent-delete');
  if (destructive && destructive.action !== stateSpecific?.action) primary.push(destructive);

  return primary.slice(0, 2);
}
