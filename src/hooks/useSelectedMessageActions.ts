import React, { useRef } from 'react';
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
import { IPC } from '../ipc/commands';

type SelectedMessageActionOptions = {
  selected: MessageSummary | null;
  /** 当前列表的可见顺序，用于操作后把阅读器移动到原位置附近。 */
  messages: MessageSummary[];
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
};

export default function useSelectedMessageActions({
  selected,
  messages,
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
}: SelectedMessageActionOptions) {
  const selectedRef = useRef<MessageSummary | null>(null);
  const labelActionInFlightRef = useRef(new Set<string>());

  selectedRef.current = selected;

  return React.useMemo(() => {
    async function refreshSourceAndSelectNeighbor(messageId: number) {
      const previousIndex = messages.findIndex((message) => message.id === messageId);
      await loadMeta(folderId);
      const refreshedMessages = await loadMessages(folderId);
      const messageStillVisible = refreshedMessages.some((message) => message.id === messageId);

      if (messageStillVisible) {
        // 全局搜索等统一视图可能仍包含已移动邮件；保留当前阅读上下文。
        setSelectedId(messageId);
        return;
      }

      clearSelectedDetailIf(messageId);
      // 删除中间项后，同一索引就是原列表的下一项；删除末项时自然回退到前一项。
      // 线程内邮件不一定存在于顶层 messages，此时退回刷新后第一封可见邮件。
      const fallbackIndex = previousIndex >= 0
        ? Math.min(previousIndex, refreshedMessages.length - 1)
        : 0;
      setSelectedId(refreshedMessages[fallbackIndex]?.id ?? null);
    }

    async function moveSelected(role: FolderRole) {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const report = await invoke<RemoteActionReport>(IPC.MoveMessageToRole, { messageId: selected.id, role });
      patchSelectedDetailMetadata(selected.id, { folder_role: role });
      await refreshSourceAndSelectNeighbor(selected.id);
      setStatus(report.message);
      queueUndoAction(role === 'trash' ? '移到废纸篓' : role === 'archive' ? '归档' : `移动到 ${role}`, undoSnapshots);
    }

    async function moveSelectedToFolder(folder: Folder) {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const report = await invoke<RemoteActionReport>(IPC.MoveMessageToRole, { messageId: selected.id, role: folder.role });
      patchSelectedDetailMetadata(selected.id, { folder_id: folder.id, folder_role: folder.role });
      await refreshSourceAndSelectNeighbor(selected.id);
      setStatus(`已移动到 ${folder.name}`);
      queueUndoAction(`移动到 ${folder.name}`, undoSnapshots, report.message);
    }

    async function markSelectedAsSpam() {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      await invoke(IPC.MoveMessageToRole, { messageId: selected.id, role: 'spam' });
      patchSelectedDetailMetadata(selected.id, { folder_role: 'spam' });
      await refreshSourceAndSelectNeighbor(selected.id);
      setStatus('已标为垃圾邮件');
      queueUndoAction('标为垃圾邮件', undoSnapshots);
    }

    async function markSelectedNotSpam() {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const result = await invoke<RestoreMessageReport>(IPC.RestoreMessageToInbox, { messageId: selected.id });
      patchSelectedDetailMetadata(selected.id, {
        folder_id: result.restored.folder_id,
        folder_role: result.restored.folder_role,
        is_read: result.restored.is_read,
        is_starred: result.restored.is_starred,
        labels: result.restored.labels,
        snoozed_until: result.restored.snoozed_until,
        remote_mailbox: result.restored.remote_mailbox,
        remote_uid: result.restored.remote_uid,
      });
      await refreshSourceAndSelectNeighbor(selected.id);
      setStatus('已移回收件箱，并标记为不是垃圾邮件');
      queueUndoAction('不是垃圾邮件', undoSnapshots, result.remote.message);
    }

    async function restoreSelectedFromTrash() {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const result = await invoke<RestoreMessageReport>(IPC.RestoreMessageToInbox, { messageId: selected.id });
      patchSelectedDetailMetadata(selected.id, {
        folder_id: result.restored.folder_id,
        folder_role: result.restored.folder_role,
        is_read: result.restored.is_read,
        is_starred: result.restored.is_starred,
        labels: result.restored.labels,
        snoozed_until: result.restored.snoozed_until,
        remote_mailbox: result.restored.remote_mailbox,
        remote_uid: result.restored.remote_uid,
      });
      await refreshSourceAndSelectNeighbor(selected.id);
      setStatus(result.remote.message);
      queueUndoAction('恢复到收件箱', undoSnapshots, result.remote.message);
    }

    async function unsnoozeSelected() {
      if (!selected) return;
      const undoSnapshots = snapshotMessages([selected]);
      const updated = await invoke<Message>(IPC.UnsnoozeMessage, { messageId: selected.id });
      patchSelectedDetailMetadata(selected.id, {
        folder_id: updated.folder_id,
        folder_role: updated.folder_role,
        is_read: updated.is_read,
        snoozed_until: updated.snoozed_until,
      });
      await refreshSourceAndSelectNeighbor(selected.id);
      setStatus('已取消稍后处理');
      queueUndoAction('取消稍后处理', undoSnapshots);
    }

    async function toggleLabel(label: Label) {
      const active = selectedRef.current;
      if (!active) return;
      const actionKey = `${active.id}:${label.id}`;
      if (labelActionInFlightRef.current.has(actionKey)) return;
      labelActionInFlightRef.current.add(actionKey);

      const undoSnapshots = snapshotMessages([active]);
      try {
        const latestLabels = selectedRef.current?.id === active.id
          ? selectedRef.current.labels
          : active.labels;
        const hasLabel = latestLabels.includes(label.name);
        await toggleMessagesLabel([active], label, hasLabel);
        const nextLabels = hasLabel
          ? latestLabels.filter((l) => l !== label.name)
          : [...latestLabels, label.name];
        patchSelectedDetailMetadata(active.id, { labels: nextLabels });
        await refreshAll();
        setStatus(hasLabel ? `已移除标签：${label.name}` : `已添加标签：${label.name}`);
        queueUndoAction(hasLabel ? `移除标签 ${label.name}` : `添加标签 ${label.name}`, undoSnapshots);
      } finally {
        labelActionInFlightRef.current.delete(actionKey);
      }
    }


    return {
      moveSelected,
      moveSelectedToFolder,
      markSelectedAsSpam,
      markSelectedNotSpam,
      restoreSelectedFromTrash,
      unsnoozeSelected,
      toggleLabel,
    };
  }, [
    selected,
    messages,
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
  ]);
}
