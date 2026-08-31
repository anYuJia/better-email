import React from 'react';
import type {
  Folder,
  Label,
  MessageSummary,
  ThreadSummary,
  UndoMessageSnapshot,
} from '../app/types';
import {
  messageCollectionActionLabel,
  messagesForCollectionAction,
  type BulkMessageAction,
} from '../app/messageActionState';
import { invoke } from '../tauriBridge';
import {
  crossAccountBlockReason,
  moveMessagesToRole,
  setMessagesRead,
  setMessagesStarred,
  threadMovableMessages,
  toggleMessagesLabel,
  uniqueMessages,
} from './messageActionUtils';
import { movableFoldersForBulk } from '../app/appConfig';
import { IPC } from '../ipc/commands';

type BulkMessageActionOptions = {
  folders: Folder[];
  selectedMessages: MessageSummary[];
  refreshAll: () => Promise<void>;
  setActiveThread: React.Dispatch<React.SetStateAction<ThreadSummary | null>>;
  setSelectedMessageIds: React.Dispatch<React.SetStateAction<number[]>>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  onRequestPermanentDelete: (messages: MessageSummary[]) => void;
  snapshotMessages: (messages: MessageSummary[]) => UndoMessageSnapshot[];
  queueUndoAction: (
    title: string,
    snapshots: UndoMessageSnapshot[],
    detail?: string,
  ) => void;
  onReadStateChange?: (messageIds: number[], isRead: boolean) => void;
};

export default function useBulkMessageActions({
  folders,
  selectedMessages,
  refreshAll,
  setActiveThread,
  setSelectedMessageIds,
  setStatus,
  onRequestPermanentDelete,
  snapshotMessages,
  queueUndoAction,
  onReadStateChange,
}: BulkMessageActionOptions) {
  return React.useMemo(() => {
    async function runMessageCollectionAction(
      items: MessageSummary[],
      action: BulkMessageAction,
      context: 'bulk' | 'thread',
      threadTitle = '',
    ) {
      const sourceMessages = uniqueMessages(items);
      const targetMessages = messagesForCollectionAction(items, action, context);
      if (targetMessages.length === 0) {
        if (sourceMessages.length === 0) {
          setStatus(context === 'thread' ? '会话中没有可操作的邮件' : '请先选择邮件');
        } else {
          const actionLabel = messageCollectionActionLabel(action);
          setStatus(context === 'thread' ? `会话中没有可${actionLabel}的邮件` : `所选邮件无法${actionLabel}`);
        }
        return;
      }
      if (action === 'permanent-delete') {
        onRequestPermanentDelete(targetMessages);
        return;
      }
      const undoSnapshots = snapshotMessages(targetMessages);
      if (action === 'read' || action === 'unread') {
        await setMessagesRead(targetMessages, action === 'read');
      } else if (action === 'star' || action === 'unstar') {
        await setMessagesStarred(targetMessages, action === 'star');
      } else if (action === 'restore' || action === 'not-spam') {
        for (const message of targetMessages) {
          await invoke(IPC.RestoreMessageToInbox, { messageId: message.id });
        }
      } else if (action === 'unsnooze') {
        for (const message of targetMessages) {
          await invoke(IPC.UnsnoozeMessage, { messageId: message.id });
        }
      } else {
        await moveMessagesToRole(targetMessages, action === 'spam' ? 'spam' : action);
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
      const actionLabel = messageCollectionActionLabel(action);
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
      items: MessageSummary[],
      action: BulkMessageAction,
    ) {
      await runMessageCollectionAction(
        items,
        action,
        'thread',
        thread.subject,
      );
    }

    async function moveMessageCollectionToFolder(
      items: MessageSummary[],
      folder: Folder,
      context: 'bulk' | 'thread',
      threadTitle = '',
    ) {
      const targetMessages = uniqueMessages(items)
        .filter((message) => message.folder_role !== folder.role);
      if (targetMessages.length === 0) {
        setStatus(uniqueMessages(items).length === 0
          ? '请先选择邮件'
          : context === 'thread'
            ? `会话邮件已在 ${folder.name}`
            : `所选邮件已在 ${folder.name}`);
        return;
      }
      const canMove = movableFoldersForBulk(folders, targetMessages)
        .some((candidate) => candidate.id === folder.id);
      if (!canMove) {
        setStatus(crossAccountBlockReason(targetMessages) ?? '此文件夹不能接收这些邮件');
        return;
      }
      const undoSnapshots = snapshotMessages(targetMessages);
      await moveMessagesToRole(targetMessages, folder.role);
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
      items: MessageSummary[],
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
      items: MessageSummary[],
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
      await toggleMessagesLabel(targetMessages, label, shouldRemove);
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
      items: MessageSummary[],
      label: Label,
    ) {
      await toggleMessageCollectionLabel(items, label, 'thread', thread.subject);
    }

    async function toggleThreadMuted(thread: ThreadSummary, items: MessageSummary[]) {
      const targetMessages = uniqueMessages(items);
      if (targetMessages.length === 0) {
        setStatus('会话中没有可静音的邮件');
        return;
      }
      const muted = !thread.is_muted;
      const updatedScopes = await invoke<number>(IPC.SetThreadsMuted, {
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
    onRequestPermanentDelete,
  ]);
}
