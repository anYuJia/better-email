import {
  Archive,
  AtSign,
  Clock,
  Copy,
  FileText,
  FolderInput,
  Forward,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  RotateCcw,
  ShieldAlert,
  Star,
  StarOff,
  Tag,
  Trash2,
} from 'lucide-react';
import { movableFoldersForBulk } from '../app/appConfig';
import { canSnoozeRole } from '../app/snooze';
import {
  buildMessageCollectionActionState,
  canArchiveMessageRole,
  canChangeMessageReadStateRole,
  canMarkMessageAsSpamRole,
  canReplyToMessageRole,
  collectionActionDetail,
  type BulkMessageAction,
  type MessageCollectionActionEntry,
  type MessageCollectionScope,
} from '../app/messageActionState';
import type { Folder, Label, MessageSummary } from '../app/types';
import type { ContextMenuItem } from './ContextMenu';

export type { BulkMessageAction } from '../app/messageActionState';
export type ComposeMode = 'reply' | 'replyAll' | 'forward';
export type MessageContextAction =
  | 'archive'
  | 'trash'
  | 'read'
  | 'unread'
  | 'star'
  | 'unstar'
  | 'spam'
  | 'not-spam'
  | 'restore'
  | 'snooze'
  | 'unsnooze'
  | 'copy-sender'
  | 'copy-subject'
  | 'permanent-delete';

type BulkContextOptions = {
  selectedMessages: MessageSummary[];
  movableMessages?: MessageSummary[];
  scope?: MessageCollectionScope;
  folders: Folder[];
  labels: Label[];
  onRunBulkAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: MessageSummary[]) => void;
  onMoveBulkToFolder: (folder: Folder) => void;
  onToggleBulkLabel: (label: Label) => void;
};

export function buildBulkMessageContextItems({
  selectedMessages,
  movableMessages = selectedMessages,
  scope = 'bulk',
  folders,
  labels,
  onRunBulkAction,
  onRequestSnooze,
  onMoveBulkToFolder,
  onToggleBulkLabel,
}: BulkContextOptions): ContextMenuItem[] {
  const actionState = buildMessageCollectionActionState(selectedMessages, scope);
  const movableFolders = movableFoldersForBulk(folders, movableMessages);
  const iconForAction = (item: MessageCollectionActionEntry) => {
    switch (item.action) {
      case 'read': return <MailOpen size={15} />;
      case 'unread': return <Mail size={15} />;
      case 'star': return <Star size={15} />;
      case 'unstar': return <StarOff size={15} />;
      case 'snooze':
      case 'unsnooze': return <Clock size={15} />;
      case 'archive': return <Archive size={15} />;
      case 'restore':
      case 'not-spam': return <RotateCcw size={15} />;
      case 'spam': return <ShieldAlert size={15} />;
      case 'trash':
      case 'permanent-delete': return <Trash2 size={15} />;
    }
  };
  const actionItems = actionState.entries.map((item, index, items): ContextMenuItem => {
    const actionDetail = collectionActionDetail(item.messages.length, actionState.totalCount);
    return {
      id: item.action === 'read' || item.action === 'unread'
        ? `${scope}-read-state`
        : item.action === 'star' || item.action === 'unstar'
          ? `${scope}-star-state`
          : `${scope}-${item.action}`,
      label: item.label,
      // The menu heading already describes the whole selection. Show a second
      // line only when an action applies to a subset instead of repeating
      // “N 封邮件” on every row.
      detail: item.messages.length === actionState.totalCount ? undefined : actionDetail,
      tooltip: `${item.label} · ${actionDetail}`,
      icon: iconForAction(item),
      shortcut: item.shortcut,
      danger: item.danger,
      separatorBefore: index > 0 && items[index - 1].group !== item.group,
      onSelect: () => {
        if (item.action === 'snooze') {
          onRequestSnooze(item.messages);
        } else {
          onRunBulkAction(item.action);
        }
      },
    };
  });
  const dangerIndex = actionItems.findIndex((item) => item.danger);
  const beforeDanger = dangerIndex < 0 ? actionItems.length : dangerIndex;

  const collectionItems: ContextMenuItem[] = [];
  if (movableFolders.length > 0) {
    collectionItems.push({
      id: `${scope}-move`,
      label: '移动到',
      icon: <FolderInput size={15} />,
      children: movableFolders.map((folder) => ({
        id: `${scope}-move-${folder.id}`,
        label: folder.name,
        onSelect: () => onMoveBulkToFolder(folder),
      })),
    });
  }
  if (labels.length > 0) {
    collectionItems.push({
      id: `${scope}-labels`,
      label: '标签',
      icon: <Tag size={15} />,
      children: labels.map((label) => ({
        id: `${scope}-label-${label.id}`,
        label: label.name,
        icon: <span className="label-dot" style={{ background: label.color }} />,
        checked: selectedMessages.length > 0
          && selectedMessages.every((message) => message.labels.includes(label.name)),
        onSelect: () => onToggleBulkLabel(label),
      })),
    });
  }
  actionItems.splice(beforeDanger, 0, ...collectionItems);
  return actionItems;
}

type SingleContextOptions = {
  message: MessageSummary;
  folders: Folder[];
  labels: Label[];
  onSelectMessage: (messageId: number) => void;
  onComposeFromMessage: (message: MessageSummary, mode: ComposeMode) => void;
  onRunMessageAction: (message: MessageSummary, action: MessageContextAction) => void;
  onMoveMessageToFolder: (message: MessageSummary, folder: Folder) => void;
  onToggleMessageLabel: (message: MessageSummary, label: Label) => void;
};

export function buildSingleMessageContextItems({
  message,
  folders,
  labels,
  onSelectMessage,
  onComposeFromMessage,
  onRunMessageAction,
  onMoveMessageToFolder,
  onToggleMessageLabel,
}: SingleContextOptions): ContextMenuItem[] {
  const movableFolders = movableFoldersForBulk(folders, [message]);

  return [
    {
      id: 'open',
      label: '打开邮件',
      icon: <MailOpen size={15} />,
      onSelect: () => onSelectMessage(message.id),
    },
    ...(canReplyToMessageRole(message.folder_role)
      ? [
          {
            id: 'reply',
            label: '回复',
            icon: <Reply size={15} />,
            shortcut: 'R',
            onSelect: () => onComposeFromMessage(message, 'reply'),
          },
          {
            id: 'reply-all',
            label: '回复全部',
            icon: <ReplyAll size={15} />,
            onSelect: () => onComposeFromMessage(message, 'replyAll'),
          },
          {
            id: 'forward',
            label: '转发',
            icon: <Forward size={15} />,
            shortcut: 'F',
            onSelect: () => onComposeFromMessage(message, 'forward'),
          },
        ]
      : []),
    ...(canChangeMessageReadStateRole(message.folder_role)
      ? [{
          id: 'read-state',
          label: message.is_read ? '标为未读' : '标为已读',
          icon: message.is_read ? <Mail size={15} /> : <MailOpen size={15} />,
          shortcut: 'M',
          separatorBefore: canReplyToMessageRole(message.folder_role),
          onSelect: () => onRunMessageAction(message, message.is_read ? 'unread' : 'read'),
        }]
      : []),
    {
      id: 'star-state',
      label: message.is_starred ? '取消星标' : '添加星标',
      icon: message.is_starred ? <StarOff size={15} /> : <Star size={15} />,
      shortcut: 'S',
      onSelect: () => onRunMessageAction(message, message.is_starred ? 'unstar' : 'star'),
    },
    ...(message.folder_role === 'trash'
      ? [
          {
            id: 'restore',
            label: '恢复到收件箱',
            icon: <RotateCcw size={15} />,
            separatorBefore: true,
            onSelect: () => onRunMessageAction(message, 'restore'),
          },
        ]
      : message.folder_role === 'snoozed'
        ? [
            {
              id: 'unsnooze',
              label: '取消稍后处理',
              icon: <Clock size={15} />,
              separatorBefore: true,
              onSelect: () => onRunMessageAction(message, 'unsnooze'),
            },
          ]
        : canSnoozeRole(message.folder_role)
          ? [
              {
                id: 'snooze',
                label: '稍后处理',
                icon: <Clock size={15} />,
                separatorBefore: true,
                onSelect: () => onRunMessageAction(message, 'snooze'),
              },
            ]
          : []),
    ...(canArchiveMessageRole(message.folder_role)
      ? [
          {
            id: 'archive',
            label: '归档',
            icon: <Archive size={15} />,
            shortcut: 'E',
            onSelect: () => onRunMessageAction(message, 'archive'),
          },
        ]
      : []),
    ...(movableFolders.length > 0
      ? [{
          id: 'move',
          label: '移动到',
          icon: <FolderInput size={15} />,
          children: movableFolders.map((folder) => ({
            id: `move-${folder.id}`,
            label: folder.name,
            onSelect: () => onMoveMessageToFolder(message, folder),
          })),
        }]
      : []),
    ...(labels.length > 0
      ? [{
          id: 'labels',
          label: '标签',
          icon: <Tag size={15} />,
          children: labels.map((label) => ({
            id: `label-${label.id}`,
            label: label.name,
            icon: <span className="label-dot" style={{ background: label.color }} />,
            checked: message.labels.includes(label.name),
            onSelect: () => onToggleMessageLabel(message, label),
          })),
        }]
      : []),
    {
      id: 'copy-message-info',
      label: '复制信息',
      icon: <Copy size={15} />,
      separatorBefore: true,
      children: [
        {
          id: 'copy-sender',
          label: '发件人邮箱',
          icon: <AtSign size={15} />,
          disabled: !message.sender_email.trim(),
          onSelect: () => onRunMessageAction(message, 'copy-sender'),
        },
        {
          id: 'copy-subject',
          label: '邮件主题',
          icon: <FileText size={15} />,
          disabled: !message.subject.trim(),
          onSelect: () => onRunMessageAction(message, 'copy-subject'),
        },
      ],
    },
    ...(message.folder_role === 'spam'
      ? [
          {
            id: 'not-spam',
            label: '不是垃圾邮件',
            icon: <RotateCcw size={15} />,
            separatorBefore: true,
            onSelect: () => onRunMessageAction(message, 'not-spam'),
          },
        ]
      : canMarkMessageAsSpamRole(message.folder_role)
        ? [
            {
              id: 'spam',
              label: '标为垃圾邮件',
              icon: <ShieldAlert size={15} />,
              separatorBefore: true,
              onSelect: () => onRunMessageAction(message, 'spam'),
            },
          ]
        : []),
    ...(message.folder_role === 'trash'
      ? [
          {
            id: 'permanent-delete',
            label: '永久删除',
            icon: <Trash2 size={15} />,
            danger: true,
            separatorBefore: true,
            onSelect: () => onRunMessageAction(message, 'permanent-delete'),
          },
        ]
      : [
          {
            id: 'trash',
            label: '移到废纸篓',
            icon: <Trash2 size={15} />,
            danger: true,
            separatorBefore: true,
            onSelect: () => onRunMessageAction(message, 'trash'),
          },
        ]),
  ];
}
