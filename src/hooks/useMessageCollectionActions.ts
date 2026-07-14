import React from 'react';
import { movableFoldersForBulk } from '../app/appConfig';
import type {
  Folder,
  Label,
  Message,
  ThreadSummary,
  UndoMessageSnapshot,
} from '../app/types';
import type { BulkMessageAction } from '../components/messageContextMenu';
import { invoke } from '../tauriBridge';

type MessageCollectionActionOptions = {
  folders: Folder[];
  selectedMessages: Message[];
  refreshAll: () => Promise<void>;
  setActiveThread: React.Dispatch<React.SetStateAction<ThreadSummary | null>>;
  setSelectedMessageIds: React.Dispatch<React.SetStateAction<number[]>>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  snapshotMessages: (messages: Message[]) => UndoMessageSnapshot[];
  queueUndoAction: (
    title: string,
    snapshots: UndoMessageSnapshot[],
    detail?: string,
  ) => void;
  onReadStateChange?: (messageIds: number[], isRead: boolean) => void;
};

function uniqueMessages(items: Message[]) {
  return [...new Map(items.map((message) => [message.id, message])).values()];
}

function threadMessagesForAction(items: Message[], action: BulkMessageAction) {
  if (action === 'archive') {
    return items.filter(
      (message) => !['archive', 'drafts', 'sent', 'trash'].includes(message.folder_role),
    );
  }
  if (action === 'trash') {
    return items.filter(
      (message) => message.folder_role !== 'drafts' && message.folder_role !== 'trash',
    );
  }
  return items;
}

function threadMovableMessages(items: Message[]) {
  return items.filter(
    (message) => message.folder_role !== 'drafts' && message.folder_role !== 'sent',
  );
}

export default function useMessageCollectionActions({
  folders,
  selectedMessages,
  refreshAll,
  setActiveThread,
  setSelectedMessageIds,
  setStatus,
  snapshotMessages,
  queueUndoAction,
  onReadStateChange,
}: MessageCollectionActionOptions) {
  return React.useMemo(() => {
    async function runMessageCollectionAction(
      items: Message[],
      action: BulkMessageAction,
      context: 'bulk' | 'thread',
      threadTitle = '',
    ) {
      const targetMessages = uniqueMessages(items);
      if (targetMessages.length === 0) {
        setStatus(context === 'thread' ? '会话中没有可执行此操作的邮件' : '请先选择邮件');
        return;
      }
      const undoSnapshots = snapshotMessages(targetMessages);
      for (const message of targetMessages) {
        if (action === 'read' || action === 'unread') {
          await invoke('set_message_read', {
            messageId: message.id,
            isRead: action === 'read',
          });
        } else if (action === 'star' || action === 'unstar') {
          await invoke('set_message_starred', {
            messageId: message.id,
            isStarred: action === 'star',
          });
        } else {
          await invoke('move_message_to_role', {
            messageId: message.id,
            role: action,
          });
        }
      }
      if (action === 'read' || action === 'unread') {
        onReadStateChange?.(
          targetMessages.map((message) => message.id),
          action === 'read',
        );
      }
      const count = targetMessages.length;
      setSelectedMessageIds([]);
      await refreshAll();
      const actionLabel =
        action === 'read'
          ? '标为已读'
          : action === 'unread'
            ? '标为未读'
            : action === 'star'
              ? '添加星标'
              : action === 'unstar'
                ? '取消星标'
                : action === 'archive'
                  ? '归档'
                  : '删除';
      if (context === 'thread') {
        setStatus(`已对会话${actionLabel} ${count} 封邮件：${threadTitle || '(无主题)'}`);
        queueUndoAction(`会话${actionLabel}`, undoSnapshots, `${count} 封邮件`);
      } else {
        setStatus(`已批量${actionLabel} ${count} 封邮件`);
        queueUndoAction(`批量${actionLabel}`, undoSnapshots, `${count} 封邮件`);
      }
    }

    async function runBulkAction(action: BulkMessageAction) {
      await runMessageCollectionAction(selectedMessages, action, 'bulk');
    }

    async function runThreadAction(
      thread: ThreadSummary,
      items: Message[],
      action: BulkMessageAction,
    ) {
      await runMessageCollectionAction(
        threadMessagesForAction(items, action),
        action,
        'thread',
        thread.subject,
      );
    }

    async function moveMessageCollectionToFolder(
      items: Message[],
      folder: Folder,
      context: 'bulk' | 'thread',
      threadTitle = '',
    ) {
      const targetMessages = uniqueMessages(items)
        .filter((message) => message.folder_role !== folder.role);
      if (targetMessages.length === 0) {
        setStatus(context === 'thread' ? `会话邮件已在 ${folder.name}` : '请先选择邮件');
        return;
      }
      const canMove = movableFoldersForBulk(folders, targetMessages)
        .some((candidate) => candidate.id === folder.id);
      if (!canMove) {
        const accountCount = new Set(targetMessages.map((message) => message.account_id)).size;
        setStatus(
          accountCount > 1
            ? '不同账号的邮件不能移动到同一文件夹'
            : '此文件夹不能接收这些邮件',
        );
        return;
      }
      const undoSnapshots = snapshotMessages(targetMessages);
      for (const message of targetMessages) {
        await invoke('move_message_to_role', {
          messageId: message.id,
          role: folder.role,
        });
      }
      const count = targetMessages.length;
      setSelectedMessageIds([]);
      await refreshAll();
      if (context === 'thread') {
        setStatus(`已移动会话到 ${folder.name}：${count} 封邮件 · ${threadTitle || '(无主题)'}`);
        queueUndoAction(`会话移动到 ${folder.name}`, undoSnapshots, `${count} 封邮件`);
      } else {
        setStatus(`已批量移动到 ${folder.name}：${count} 封邮件`);
        queueUndoAction(`批量移动到 ${folder.name}`, undoSnapshots, `${count} 封邮件`);
      }
    }

    async function moveSelectedMessagesToFolder(folder: Folder) {
      await moveMessageCollectionToFolder(selectedMessages, folder, 'bulk');
    }

    async function moveThreadToFolder(
      thread: ThreadSummary,
      items: Message[],
      folder: Folder,
    ) {
      await moveMessageCollectionToFolder(
        threadMovableMessages(items),
        folder,
        'thread',
        thread.subject,
      );
    }

    async function toggleMessageCollectionLabel(
      items: Message[],
      label: Label,
      context: 'bulk' | 'thread',
      threadTitle = '',
    ) {
      const targetMessages = uniqueMessages(items);
      if (targetMessages.length === 0) {
        setStatus(context === 'thread' ? '会话中没有可标记的邮件' : '请先选择邮件');
        return;
      }
      const undoSnapshots = snapshotMessages(targetMessages);
      const shouldRemove = targetMessages.every(
        (message) => message.labels.includes(label.name),
      );
      for (const message of targetMessages) {
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
      const count = targetMessages.length;
      setSelectedMessageIds([]);
      await refreshAll();
      const actionLabel = shouldRemove ? '移除' : '添加';
      if (context === 'thread') {
        setStatus(
          `已为会话${actionLabel}标签 ${label.name}：${count} 封邮件 · ${threadTitle || '(无主题)'}`,
        );
        queueUndoAction(
          `会话${actionLabel}标签 ${label.name}`,
          undoSnapshots,
          `${count} 封邮件`,
        );
      } else {
        setStatus(`已批量${actionLabel}标签 ${label.name}：${count} 封邮件`);
        queueUndoAction(
          `批量${actionLabel}标签 ${label.name}`,
          undoSnapshots,
          `${count} 封邮件`,
        );
      }
    }

    async function toggleBulkLabel(label: Label) {
      await toggleMessageCollectionLabel(selectedMessages, label, 'bulk');
    }

    async function toggleThreadLabel(
      thread: ThreadSummary,
      items: Message[],
      label: Label,
    ) {
      await toggleMessageCollectionLabel(items, label, 'thread', thread.subject);
    }

    async function toggleThreadMuted(thread: ThreadSummary, items: Message[]) {
      const targetMessages = uniqueMessages(items);
      if (targetMessages.length === 0) {
        setStatus('会话中没有可静音的邮件');
        return;
      }
      const muted = !thread.is_muted;
      const updatedScopes = await invoke<number>('set_threads_muted', {
        messageIds: targetMessages.map((message) => message.id),
        muted,
      });
      if (updatedScopes <= 0) {
        setStatus('会话缺少可持久化的会话标识');
        return;
      }
      await refreshAll();
      setActiveThread((current) => (
        current?.thread_key === thread.thread_key
          ? { ...current, is_muted: muted }
          : current
      ));
      setStatus(
        muted
          ? `已静音会话：${thread.subject || '(无主题)'}`
          : `已取消静音会话：${thread.subject || '(无主题)'}`,
      );
    }

    return {
      runBulkAction,
      runThreadAction,
      moveSelectedMessagesToFolder,
      moveThreadToFolder,
      toggleBulkLabel,
      toggleThreadLabel,
      toggleThreadMuted,
    };
  }, [
    folders,
    queueUndoAction,
    refreshAll,
    selectedMessages,
    setActiveThread,
    setSelectedMessageIds,
    setStatus,
    snapshotMessages,
    onReadStateChange,
  ]);
}
