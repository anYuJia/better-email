import React from 'react';
import type {
  Folder,
  FolderRole,
  Label,
  Message,
  MessageSummary,
  RemoteActionReport,
  RestoreMessageReport,
  UndoAction,
  UndoMessageSnapshot,
} from '../app/types';
import type { MessageContextAction } from '../components/messageContextMenu';
import { copyTextToClipboard } from '../app/clipboard';
import { movableFoldersForBulk } from '../app/appConfig';
import type { LoadMetaResult } from './useAppMetaLoader';
import { invoke } from '../tauriBridge';
import { crossAccountBlockReason, moveMessagesToRole, toggleMessagesLabel, uniqueMessages } from './messageActionUtils';

type SingleMessageActionOptions = {
  folders: Folder[];
  selected: MessageSummary | null;
  selectedId: number | null;
  messages: MessageSummary[];
  labels: Label[];
  folderId: number | null;
  refreshAll: () => Promise<void>;
  loadMeta: (folderId: number | null) => Promise<LoadMetaResult>;
  loadMessages: (folderId: number | null) => Promise<MessageSummary[]>;
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

export default function useSingleMessageActions({
  folders,
  selected,
  selectedId,
  messages,
  labels,
  folderId,
  refreshAll,
  loadMeta,
  loadMessages,
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
}: SingleMessageActionOptions) {
  return React.useMemo(() => {
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
        setStatus(crossAccountBlockReason(draggedMessages) ?? '此文件夹不能接收拖拽邮件');
        return;
      }

      const messagesToMove = draggedMessages.filter((message) => message.folder_role !== folder.role);
      if (messagesToMove.length === 0) {
        setStatus(`邮件已在 ${folder.name}`);
        return;
      }

      const undoSnapshots = snapshotMessages(messagesToMove);
      await moveMessagesToRole(messagesToMove, folder.role);

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
      await toggleMessagesLabel([selected], label, hasLabel);
      const nextLabels = hasLabel
        ? selected.labels.filter((l) => l !== label.name)
        : [...selected.labels, label.name];
      patchSelectedDetailMetadata(selected.id, { labels: nextLabels });
      await refreshAll();
      setStatus(hasLabel ? `已移除标签：${label.name}` : `已添加标签：${label.name}`);
      queueUndoAction(hasLabel ? `移除标签 ${label.name}` : `添加标签 ${label.name}`, undoSnapshots);
    }

    return {
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
    folderId,
    refreshAll,
    loadMeta,
    loadMessages,
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
