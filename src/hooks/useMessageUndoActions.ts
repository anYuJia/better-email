import React from 'react';
import type {
  Folder,
  FolderRole,
  Label,
  Message,
  MessageSummary,
  UndoAction,
  UndoMessageSnapshot,
} from '../app/types';
import { movableFoldersForBulk } from '../app/appConfig';
import type { LoadMetaResult } from './useAppMetaLoader';
import { invoke } from '../tauriBridge';
import { crossAccountBlockReason, moveMessagesToRole } from './messageActionUtils';
import { IPC } from '../ipc/commands';

type MessageUndoActionOptions = {
  folders: Folder[];
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
  visibleFolderIdForRole: (
    role: FolderRole,
    accountId?: number | null,
  ) => number | null;
};

export default function useMessageUndoActions({
  folders,
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
  visibleFolderIdForRole,
}: MessageUndoActionOptions) {
  return React.useMemo(() => {
    async function restoreUndoAction() {
      const action = consumeUndoAction();
      if (!action) return;
      for (const snapshot of action.snapshots) {
        if (snapshot.folder_role === 'snoozed' && snapshot.snoozed_until) {
          await invoke(IPC.SnoozeMessage, { messageId: snapshot.id, snoozedUntil: snapshot.snoozed_until });
        } else {
          await invoke(IPC.MoveMessageToRole, { messageId: snapshot.id, role: snapshot.folder_role });
        }
        await invoke(IPC.SetMessageRead, { messageId: snapshot.id, isRead: snapshot.is_read });
        await invoke(IPC.SetMessageStarred, { messageId: snapshot.id, isStarred: snapshot.is_starred });
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

    return {
      restoreUndoAction,
      moveMessagesToFolderByIds,
    };
  }, [
    folders,
    labels,
    messages,
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
    visibleFolderIdForRole,
  ]);
}
