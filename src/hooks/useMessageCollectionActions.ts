import React from 'react';
import { movableFoldersForBulk } from '../app/appConfig';
import { copyTextToClipboard } from '../app/clipboard';
import type {
  Folder,
  FolderRole,
  Label,
  Message,
  MessageSummary,
  RemoteActionReport,
  RestoreMessageReport,
  ThreadSummary,
  UndoAction,
  UndoMessageSnapshot,
} from '../app/types';
import type { LoadMetaResult } from './useAppMetaLoader';
import type { BulkMessageAction, MessageContextAction } from '../components/messageContextMenu';
import { invoke } from '../tauriBridge';

type MessageCollectionActionOptions = {
  folders: Folder[];
  selectedMessages: MessageSummary[];
  selected: MessageSummary | null;
  selectedId: number | null;
  messages: MessageSummary[];
  labels: Label[];
  folderId: number | null;
  refreshAll: () => Promise<void>;
  loadMeta: (folderId: number | null) => Promise<LoadMetaResult>;
  loadMessages: (folderId: number | null) => Promise<MessageSummary[]>;
  setActiveThread: React.Dispatch<React.SetStateAction<ThreadSummary | null>>;
  setSelectedMessageIds: React.Dispatch<React.SetStateAction<number[]>>;
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  snapshotMessages: (messages: MessageSummary[]) => UndoMessageSnapshot[];
  queueUndoAction: (
    title: string,
    snapshots: UndoMessageSnapshot[],
    detail?: string,
  ) => void;
  consumeUndoAction: () => UndoAction | null;
  onReadStateChange?: (messageIds: number[], isRead: boolean) => void;
  clearSelectedDetailIf: (messageId: number) => void;
  patchSelectedDetailMetadata: (
    messageId: number,
    patch: Partial<MessageSummary>,
  ) => void;
  visibleFolderIdForRole: (
    role: FolderRole,
    accountId?: number | null,
  ) => number | null;
  onRequestSnooze: (items: MessageSummary[]) => void;
  onRequestPermanentDelete: (message: MessageSummary) => void;
};

function uniqueMessages(items: MessageSummary[]) {
  return [...new Map(items.map((message) => [message.id, message])).values()];
}

function threadMessagesForAction(items: MessageSummary[], action: BulkMessageAction) {
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

function threadMovableMessages(items: MessageSummary[]) {
  return items.filter(
    (message) => message.folder_role !== 'drafts' && message.folder_role !== 'sent',
  );
}

export default function useMessageCollectionActions({
  folders,
  selectedMessages,
  selected,
  selectedId,
  messages,
  labels,
  folderId,
  refreshAll,
  loadMeta,
  loadMessages,
  setActiveThread,
  setSelectedMessageIds,
  setSelectedId,
  setStatus,
  snapshotMessages,
  queueUndoAction,
  consumeUndoAction,
  onReadStateChange,
  clearSelectedDetailIf,
  patchSelectedDetailMetadata,
  visibleFolderIdForRole,
  onRequestSnooze,
  onRequestPermanentDelete,
}: MessageCollectionActionOptions) {
  return React.useMemo(() => {
    async function runMessageCollectionAction(
      items: MessageSummary[],
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
      items: MessageSummary[],
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
      items: MessageSummary[],
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

    async function restoreUndoAction() {
      const action = consumeUndoAction();
      if (!action) return;
      for (const snapshot of action.snapshots) {
        if (snapshot.folder_role === 'snoozed' && snapshot.snoozed_until) {
          await invoke('snooze_message', { messageId: snapshot.id, snoozedUntil: snapshot.snoozed_until });
        } else {
          await invoke('move_message_to_role', { messageId: snapshot.id, role: snapshot.folder_role });
        }
        await invoke('set_message_read', { messageId: snapshot.id, isRead: snapshot.is_read });
        await invoke('set_message_starred', { messageId: snapshot.id, isStarred: snapshot.is_starred });
        for (const label of labels) {
          const shouldHaveLabel = snapshot.labels.includes(label.name);
          await invoke(shouldHaveLabel ? 'apply_label_to_message' : 'remove_label_from_message', {
            messageId: snapshot.id,
            labelId: label.id,
          });
        }
      }
      setSelectedMessageIds([]);
      const firstSnapshot = action.snapshots[0];
      const restoredFolderId = firstSnapshot
        ? visibleFolderIdForRole(firstSnapshot.folder_role, firstSnapshot.account_id) ?? folderId
        : folderId;
      await loadMeta(restoredFolderId);
      await loadMessages(restoredFolderId);
      setSelectedId(firstSnapshot?.id ?? null);
      setStatus(`已撤销：${action.title}`);
    }

    async function moveMessagesToFolderByIds(folder: Folder, messageIds: number[]) {
      const uniqueMessageIds = [...new Set(messageIds)];
      const messageById = new Map(messages.map((message) => [message.id, message]));
      const draggedMessages = uniqueMessageIds
        .map((messageId) => messageById.get(messageId))
        .filter((message): message is Message => Boolean(message));

      if (draggedMessages.length === 0) {
        setStatus('没有找到可移动的邮件');
        return;
      }

      const canMoveToFolder = movableFoldersForBulk(folders, draggedMessages)
        .some((candidate) => candidate.id === folder.id);
      if (!canMoveToFolder) {
        const accountCount = new Set(draggedMessages.map((message) => message.account_id)).size;
        setStatus(accountCount > 1 ? '不同账号的邮件不能拖到同一文件夹' : '此文件夹不能接收拖拽邮件');
        return;
      }

      const messagesToMove = draggedMessages.filter((message) => message.folder_role !== folder.role);
      if (messagesToMove.length === 0) {
        setStatus(`邮件已在 ${folder.name}`);
        return;
      }

      const undoSnapshots = snapshotMessages(messagesToMove);
      for (const message of messagesToMove) {
        await invoke('move_message_to_role', { messageId: message.id, role: folder.role });
      }

      const movedMessageIds = new Set(messagesToMove.map((message) => message.id));
      setSelectedMessageIds([]);
      if (selectedId !== null && movedMessageIds.has(selectedId)) setSelectedId(null);
      await refreshAll();
      setStatus(`已拖动到 ${folder.name}：${messagesToMove.length} 封邮件`);
      queueUndoAction(`移动到 ${folder.name}`, undoSnapshots, `${messagesToMove.length} 封邮件`);
    }

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
      await invoke(hasLabel ? 'remove_label_from_message' : 'apply_label_to_message', {
        messageId: message.id,
        labelId: label.id,
      });
      // 同步更新 selectedDetail 和 cache 中的 labels
      const nextLabels = hasLabel
        ? message.labels.filter((l) => l !== label.name)
        : [...message.labels, label.name];
      patchSelectedDetailMetadata(message.id, { labels: nextLabels });
      await refreshAll();
      setStatus(`${hasLabel ? '已移除' : '已添加'}标签 ${label.name}`);
      queueUndoAction(`${hasLabel ? '移除' : '添加'}标签 ${label.name}`, undoSnapshots);
    }

    async function moveSelected(role: FolderRole) {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const report = await invoke<RemoteActionReport>('move_message_to_role', { messageId: selected.id, role });
      // 移动后目标文件夹会继续展示该邮件，更新 metadata；body 保持原样
      patchSelectedDetailMetadata(selected.id, { folder_role: role });
      const targetFolderId = visibleFolderIdForRole(role, selected.account_id) ?? folderId;
      await loadMeta(targetFolderId);
      await loadMessages(targetFolderId);
      setSelectedId(selected.id);
      setStatus(report.message);
      queueUndoAction(role === 'trash' ? '删除' : role === 'archive' ? '归档' : `移动到 ${role}`, undoSnapshots);
    }

    async function moveSelectedToFolder(folder: Folder) {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const report = await invoke<RemoteActionReport>('move_message_to_role', { messageId: selected.id, role: folder.role });
      patchSelectedDetailMetadata(selected.id, { folder_id: folder.id, folder_role: folder.role });
      await loadMeta(folder.id);
      await loadMessages(folder.id);
      setSelectedId(selected.id);
      setStatus(`已移动到 ${folder.name}`);
      queueUndoAction(`移动到 ${folder.name}`, undoSnapshots, report.message);
    }

    async function markSelectedAsSpam() {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      await invoke('move_message_to_role', { messageId: selected.id, role: 'spam' });
      patchSelectedDetailMetadata(selected.id, { folder_role: 'spam' });
      const spamFolderId = visibleFolderIdForRole('spam', selected.account_id) ?? folderId;
      await loadMeta(spamFolderId);
      await loadMessages(spamFolderId);
      setSelectedId(selected.id);
      setStatus('已标为垃圾邮件');
      queueUndoAction('标为垃圾邮件', undoSnapshots);
    }

    async function markSelectedNotSpam() {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const result = await invoke<RestoreMessageReport>('restore_message_to_inbox', { messageId: selected.id });
      patchSelectedDetailMetadata(selected.id, {
        folder_id: result.restored.folder_id,
        folder_role: result.restored.folder_role,
        is_read: result.restored.is_read,
        is_starred: result.restored.is_starred,
        labels: result.restored.labels,
        snoozed_until: result.restored.snoozed_until,
      });
      const inboxFolderId = visibleFolderIdForRole('inbox', result.restored.account_id) ?? folderId;
      await loadMeta(inboxFolderId);
      await loadMessages(inboxFolderId);
      setSelectedId(result.restored.id);
      setStatus('已移回收件箱，并标记为不是垃圾邮件');
      queueUndoAction('不是垃圾邮件', undoSnapshots, result.remote.message);
    }

    async function restoreSelectedFromTrash() {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const result = await invoke<RestoreMessageReport>('restore_message_to_inbox', { messageId: selected.id });
      patchSelectedDetailMetadata(selected.id, {
        folder_id: result.restored.folder_id,
        folder_role: result.restored.folder_role,
        is_read: result.restored.is_read,
        is_starred: result.restored.is_starred,
        labels: result.restored.labels,
        snoozed_until: result.restored.snoozed_until,
      });
      const inboxFolderId = visibleFolderIdForRole('inbox', result.restored.account_id) ?? folderId;
      await loadMeta(inboxFolderId);
      await loadMessages(inboxFolderId);
      setSelectedId(result.restored.id);
      setStatus(result.remote.message);
      queueUndoAction('恢复到收件箱', undoSnapshots, result.remote.message);
    }

    async function permanentlyDeleteMessageConfirmed(message: MessageSummary) {
      const report = await invoke<RemoteActionReport>('delete_message_permanently', { messageId: message.id });
      clearSelectedDetailIf(message.id);
      if (selected?.id === message.id) {
        setSelectedId(null);
      }
      await refreshAll();
      setStatus(report.message);
    }

    async function unsnoozeSelected() {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const updated = await invoke<Message>('unsnooze_message', { messageId: selected.id });
      patchSelectedDetailMetadata(selected.id, {
        folder_id: updated.folder_id,
        folder_role: updated.folder_role,
        is_read: updated.is_read,
        snoozed_until: updated.snoozed_until,
      });
      const inboxFolderId = visibleFolderIdForRole('inbox', updated.account_id) ?? folderId;
      await loadMeta(inboxFolderId);
      await loadMessages(inboxFolderId);
      setSelectedId(updated.id);
      setStatus('已取消稍后处理');
      queueUndoAction('取消稍后处理', undoSnapshots);
    }

    async function toggleLabel(label: Label) {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const hasLabel = selected.labels.includes(label.name);
      await invoke(hasLabel ? 'remove_label_from_message' : 'apply_label_to_message', {
        messageId: selected.id,
        labelId: label.id,
      });
      const nextLabels = hasLabel
        ? selected.labels.filter((l) => l !== label.name)
        : [...selected.labels, label.name];
      patchSelectedDetailMetadata(selected.id, { labels: nextLabels });
      await refreshAll();
      setStatus(hasLabel ? `已移除标签：${label.name}` : `已添加标签：${label.name}`);
      queueUndoAction(hasLabel ? `移除标签 ${label.name}` : `添加标签 ${label.name}`, undoSnapshots);
    }

    return {
      runBulkAction,
      runThreadAction,
      moveSelectedMessagesToFolder,
      moveThreadToFolder,
      toggleBulkLabel,
      toggleThreadLabel,
      toggleThreadMuted,
      restoreUndoAction,
      moveMessagesToFolderByIds,
      runMessageAction,
      moveMessageToFolder,
      toggleMessageLabel,
      toggleRead,
      toggleStar,
      moveSelected,
      moveSelectedToFolder,
      markSelectedAsSpam,
      markSelectedNotSpam,
      restoreSelectedFromTrash,
      permanentlyDeleteMessageConfirmed,
      unsnoozeSelected,
      toggleLabel,
    };
  }, [
    folders,
    labels,
    messages,
    selected,
    selectedId,
    selectedMessages,
    folderId,
    refreshAll,
    loadMeta,
    loadMessages,
    setActiveThread,
    setSelectedMessageIds,
    setSelectedId,
    setStatus,
    snapshotMessages,
    queueUndoAction,
    consumeUndoAction,
    onReadStateChange,
    clearSelectedDetailIf,
    patchSelectedDetailMetadata,
    visibleFolderIdForRole,
    onRequestSnooze,
    onRequestPermanentDelete,
  ]);
}
