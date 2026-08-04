import React from 'react';
import type {
  Folder,
  Label,
  Message,
  MessageSummary,
  RemoteActionReport,
  RestoreMessageReport,
  UndoMessageSnapshot,
} from '../app/types';
import type { MessageContextAction } from '../components/messageContextMenu';
import { copyTextToClipboard } from '../app/clipboard';
import { invoke } from '../tauriBridge';
import { toggleMessagesLabel } from './messageActionUtils';

type SingleMessageActionOptions = {
  folders: Folder[];
  selected: MessageSummary | null;
  refreshAll: () => Promise<void>;
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  snapshotMessages: (messages: MessageSummary[]) => UndoMessageSnapshot[];
  queueUndoAction: (
    title: string,
    snapshots: UndoMessageSnapshot[],
    detail?: string,
  ) => void;
  onReadStateChange?: (messageIds: number[], isRead: boolean) => void;
  clearSelectedDetailIf: (messageId: number) => void;
  patchSelectedDetailMetadata: (
    messageId: number,
    patch: Partial<MessageSummary>,
  ) => void;
  onRequestSnooze: (items: MessageSummary[]) => void;
  onRequestPermanentDelete: (message: MessageSummary) => void;
};

export default function useSingleMessageActions({
  folders,
  selected,
  refreshAll,
  setSelectedId,
  setStatus,
  snapshotMessages,
  queueUndoAction,
  onReadStateChange,
  clearSelectedDetailIf,
  patchSelectedDetailMetadata,
  onRequestSnooze,
  onRequestPermanentDelete,
}: SingleMessageActionOptions) {
  return React.useMemo(() => {
    const toggleRead = async (message: MessageSummary) => {
      const undoSnapshots = snapshotMessages([message]);
      const nextRead = !message.is_read;
      const report = await invoke<RemoteActionReport>('set_message_read', { messageId: message.id, isRead: nextRead });
      onReadStateChange?.([message.id], nextRead);
      patchSelectedDetailMetadata(message.id, { is_read: nextRead });
      await refreshAll();
      setStatus(report.message);
      queueUndoAction(message.is_read ? '标为未读' : '标为已读', undoSnapshots);
    };

    const toggleStar = async (message: MessageSummary) => {
      const undoSnapshots = snapshotMessages([message]);
      const report = await invoke<RemoteActionReport>('set_message_starred', {
        messageId: message.id,
        isStarred: !message.is_starred,
      });
      patchSelectedDetailMetadata(message.id, { is_starred: !message.is_starred });
      await refreshAll();
      setStatus(report.message);
      queueUndoAction(message.is_starred ? '取消星标' : '添加星标', undoSnapshots);
    };

    async function runMessageAction(message: MessageSummary, action: MessageContextAction) {
      if (action === 'copy-sender' || action === 'copy-subject') {
        const copySender = action === 'copy-sender';
        const value = copySender ? message.sender_email : message.subject;
        await copyTextToClipboard(value);
        setStatus(copySender ? `已复制发件人邮箱：${value}` : `已复制邮件主题：${value}`);
        return;
      }

      if (action === 'read' || action === 'unread') {
        const shouldRead = action === 'read';
        if (message.is_read !== shouldRead) await toggleRead(message);
        return;
      }
      if (action === 'star' || action === 'unstar') {
        const shouldStar = action === 'star';
        if (message.is_starred !== shouldStar) await toggleStar(message);
        return;
      }

      if (action === 'snooze') {
        onRequestSnooze([message]);
        return;
      }

      const undoSnapshots = snapshotMessages([message]);
      if (action === 'permanent-delete') {
        onRequestPermanentDelete(message);
        return;
      }

      if (action === 'restore' || action === 'not-spam') {
        const result = await invoke<RestoreMessageReport>('restore_message_to_inbox', { messageId: message.id });
        clearSelectedDetailIf(message.id);
        setSelectedId(null);
        await refreshAll();
        const actionLabel = action === 'restore' ? '恢复到收件箱' : '标记为不是垃圾邮件';
        setStatus(action === 'restore' ? result.remote.message : `已${actionLabel}：${message.subject || '(无主题)'}`);
        queueUndoAction(actionLabel, undoSnapshots, result.remote.message);
        return;
      }

      if (action === 'unsnooze') {
        await invoke<Message>('unsnooze_message', { messageId: message.id });
        clearSelectedDetailIf(message.id);
        setSelectedId(null);
        await refreshAll();
        setStatus(`已取消稍后处理：${message.subject || '(无主题)'}`);
        queueUndoAction('取消稍后处理', undoSnapshots);
        return;
      }

      const targetRole = action === 'spam' ? 'spam' : action;
      await invoke('move_message_to_role', { messageId: message.id, role: targetRole });
      clearSelectedDetailIf(message.id);
      setSelectedId(null);
      await refreshAll();
      const actionLabel =
        action === 'archive'
          ? '归档'
          : action === 'spam'
            ? '标为垃圾邮件'
            : '移到废纸篓';
      setStatus(`已${actionLabel}：${message.subject || '(无主题)'}`);
      queueUndoAction(actionLabel, undoSnapshots);
    }

    async function moveMessageToFolder(message: MessageSummary, folder: Folder) {
      const undoSnapshots = snapshotMessages([message]);
      await invoke('move_message_to_role', { messageId: message.id, role: folder.role });
      clearSelectedDetailIf(message.id);
      setSelectedId(null);
      await refreshAll();
      setStatus(`已移动到 ${folder.name}：${message.subject || '(无主题)'}`);
      queueUndoAction(`移动到 ${folder.name}`, undoSnapshots);
    }

    async function toggleMessageLabel(message: MessageSummary, label: Label) {
      const undoSnapshots = snapshotMessages([message]);
      const hasLabel = message.labels.includes(label.name);
      await toggleMessagesLabel([message], label, hasLabel);
      // 同步更新 selectedDetail 和 cache 中的 labels
      const nextLabels = hasLabel
        ? message.labels.filter((l) => l !== label.name)
        : [...message.labels, label.name];
      patchSelectedDetailMetadata(message.id, { labels: nextLabels });
      await refreshAll();
      setStatus(`${hasLabel ? '已移除' : '已添加'}标签 ${label.name}`);
      queueUndoAction(`${hasLabel ? '移除' : '添加'}标签 ${label.name}`, undoSnapshots);
    }

    return {
      runMessageAction,
      moveMessageToFolder,
      toggleMessageLabel,
      toggleRead,
      toggleStar,
    };
  }, [
    folders,
    selected,
    refreshAll,
    setSelectedId,
    setStatus,
    snapshotMessages,
    queueUndoAction,
    onReadStateChange,
    clearSelectedDetailIf,
    patchSelectedDetailMetadata,
    onRequestSnooze,
    onRequestPermanentDelete,
  ]);
}
