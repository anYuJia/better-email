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
import type { Folder, Label, Message } from '../app/types';
import type { ContextMenuItem } from './ContextMenu';

export type BulkMessageAction = 'archive' | 'star' | 'unstar' | 'trash' | 'read' | 'unread';
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
  selectedMessages: Message[];
  movableMessages?: Message[];
  folders: Folder[];
  labels: Label[];
  onRunBulkAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: Message[]) => void;
  onMoveBulkToFolder: (folder: Folder) => void;
  onToggleBulkLabel: (label: Label) => void;
};

export function buildBulkMessageContextItems({
  selectedMessages,
  movableMessages = selectedMessages,
  folders,
  labels,
  onRunBulkAction,
  onRequestSnooze,
  onMoveBulkToFolder,
  onToggleBulkLabel,
}: BulkContextOptions): ContextMenuItem[] {
  const allRead = selectedMessages.every((message) => message.is_read);
  const allStarred = selectedMessages.every((message) => message.is_starred);
  const movableFolders = movableFoldersForBulk(folders, movableMessages);
  const snoozableMessages = selectedMessages.filter((message) => canSnoozeRole(message.folder_role));

  return [
    {
      id: 'bulk-read-state',
      label: allRead ? '全部标为未读' : '全部标为已读',
      icon: allRead ? <Mail size={15} /> : <MailOpen size={15} />,
      shortcut: 'M',
      onSelect: () => onRunBulkAction(allRead ? 'unread' : 'read'),
    },
    {
      id: 'bulk-star-state',
      label: allStarred ? '取消全部星标' : '全部添加星标',
      icon: allStarred ? <StarOff size={15} /> : <Star size={15} />,
      shortcut: 'S',
      onSelect: () => onRunBulkAction(allStarred ? 'unstar' : 'star'),
    },
    {
      id: 'bulk-snooze',
      label: '批量稍后处理',
      detail: snoozableMessages.length === selectedMessages.length
        ? `${snoozableMessages.length} 封邮件`
        : `${snoozableMessages.length} 封可处理`,
      icon: <Clock size={15} />,
      disabled: snoozableMessages.length === 0,
      separatorBefore: true,
      onSelect: () => onRequestSnooze(snoozableMessages),
    },
    {
      id: 'bulk-archive',
      label: '批量归档',
      icon: <Archive size={15} />,
      shortcut: 'E',
      separatorBefore: true,
      onSelect: () => onRunBulkAction('archive'),
    },
    {
      id: 'bulk-move',
      label: '批量移动到',
      icon: <FolderInput size={15} />,
      disabled: movableFolders.length === 0,
      children: movableFolders.map((folder) => ({
        id: `bulk-move-${folder.id}`,
        label: folder.name,
        onSelect: () => onMoveBulkToFolder(folder),
      })),
    },
    {
      id: 'bulk-labels',
      label: '批量标签',
      icon: <Tag size={15} />,
      disabled: labels.length === 0,
      children: labels.map((label) => ({
        id: `bulk-label-${label.id}`,
        label: label.name,
        checked: selectedMessages.every((message) => message.labels.includes(label.name)),
        onSelect: () => onToggleBulkLabel(label),
      })),
    },
    {
      id: 'bulk-trash',
      label: '批量移到废纸篓',
      icon: <Trash2 size={15} />,
      danger: true,
      separatorBefore: true,
      onSelect: () => onRunBulkAction('trash'),
    },
  ];
}

type SingleContextOptions = {
  message: Message;
  folders: Folder[];
  labels: Label[];
  onSelectMessage: (messageId: number) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode) => void;
  onRunMessageAction: (message: Message, action: MessageContextAction) => void;
  onMoveMessageToFolder: (message: Message, folder: Folder) => void;
  onToggleMessageLabel: (message: Message, label: Label) => void;
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
    ...(message.folder_role !== 'drafts'
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
    {
      id: 'read-state',
      label: message.is_read ? '标为未读' : '标为已读',
      icon: message.is_read ? <Mail size={15} /> : <MailOpen size={15} />,
      shortcut: 'M',
      separatorBefore: message.folder_role !== 'drafts',
      onSelect: () => onRunMessageAction(message, message.is_read ? 'unread' : 'read'),
    },
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
    ...(message.folder_role !== 'archive'
      && message.folder_role !== 'trash'
      && message.folder_role !== 'drafts'
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
    {
      id: 'move',
      label: '移动到',
      icon: <FolderInput size={15} />,
      disabled: movableFolders.length === 0,
      children: movableFolders.map((folder) => ({
        id: `move-${folder.id}`,
        label: folder.name,
        onSelect: () => onMoveMessageToFolder(message, folder),
      })),
    },
    {
      id: 'labels',
      label: '标签',
      icon: <Tag size={15} />,
      disabled: labels.length === 0,
      children: labels.map((label) => ({
        id: `label-${label.id}`,
        label: label.name,
        checked: message.labels.includes(label.name),
        onSelect: () => onToggleMessageLabel(message, label),
      })),
    },
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
      : message.folder_role !== 'trash' && message.folder_role !== 'drafts'
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
