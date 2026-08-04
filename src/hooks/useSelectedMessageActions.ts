import React from 'react';
import type {
  Folder,
  FolderRole,
  Label,
  Message,
  MessageSummary,
  RemoteActionReport,
  RestoreMessageReport,
  UndoMessageSnapshot,
} from '../app/types';
import type { LoadMetaResult } from './useAppMetaLoader';
import { invoke } from '../tauriBridge';
import { toggleMessagesLabel } from './messageActionUtils';

type SelectedMessageActionOptions = {
  selected: MessageSummary | null;
  folders: Folder[];
  labels: Label[];
  folderId: number | null;
  refreshAll: () => Promise<void>;
  loadMeta: (folderId: number | null) => Promise<LoadMetaResult>;
  loadMessages: (folderId: number | null) => Promise<MessageSummary[]>;
  setSelectedId: React.Dispatch<React.SetStateAction<number | null>>;
  setStatus: React.Dispatch<React.SetStateAction<string>>;
  snapshotMessages: (messages: MessageSummary[]) => UndoMessageSnapshot[];
  queueUndoAction: (
    title: string,
    snapshots: UndoMessageSnapshot[],
    detail?: string,
  ) => void;
  clearSelectedDetailIf: (messageId: number) => void;
  patchSelectedDetailMetadata: (
    messageId: number,
    patch: Partial<MessageSummary>,
  ) => void;
  visibleFolderIdForRole: (
    role: FolderRole,
    accountId?: number | null,
  ) => number | null;
};

export default function useSelectedMessageActions({
  selected,
  folders,
  labels,
  folderId,
  refreshAll,
  loadMeta,
  loadMessages,
  setSelectedId,
  setStatus,
  snapshotMessages,
  queueUndoAction,
  clearSelectedDetailIf,
  patchSelectedDetailMetadata,
  visibleFolderIdForRole,
}: SelectedMessageActionOptions) {
  return React.useMemo(() => {
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
    selected,
    folders,
    labels,
    folderId,
    refreshAll,
    loadMeta,
    loadMessages,
    setSelectedId,
    setStatus,
    snapshotMessages,
    queueUndoAction,
    clearSelectedDetailIf,
    patchSelectedDetailMetadata,
    visibleFolderIdForRole,
  ]);
}
