import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Folder, FolderReadReport } from '../app/types';
import { invoke } from '../tauriBridge';

type FolderManagementOptions = {
  folderId: number | null;
  currentFolderAccountId: () => number | null;
  visibleFolderIdForRole: (role: Folder['role'], accountId?: number | null) => number | null;
  loadMeta: (folderId: number | null) => Promise<{ folderId: number | null }>;
  loadMessages: (folderId: number | null) => Promise<unknown>;
  refreshAll: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useFolderManagement({
  folderId,
  currentFolderAccountId,
  visibleFolderIdForRole,
  loadMeta,
  loadMessages,
  refreshAll,
  setStatus,
}: FolderManagementOptions) {
  const [customFolderName, setCustomFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [renamingFolderName, setRenamingFolderName] = useState('');
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<Folder | null>(null);

  async function createCustomFolder() {
    const name = customFolderName.trim();
    if (!name) {
      setStatus('请输入自定义文件夹名称');
      return;
    }
    const accountId = currentFolderAccountId();
    if (!accountId) {
      setStatus('请先创建或选择邮箱账号');
      return;
    }
    const folder = await invoke<Folder>('create_custom_folder', { accountId, name });
    setCustomFolderName('');
    const { folderId: nextFolderId } = await loadMeta(folderId);
    await loadMessages(nextFolderId);
    setStatus(`已创建文件夹：${folder.name}`);
  }

  function startRenameCustomFolder(folder: Folder) {
    setRenamingFolderId(folder.id);
    setRenamingFolderName(folder.name);
  }

  async function renameCustomFolder(folder: Folder) {
    const name = renamingFolderName.trim();
    if (!name) {
      setStatus('请输入新的文件夹名称');
      return;
    }
    const renamed = await invoke<Folder>('rename_custom_folder', { folderId: folder.id, name });
    setRenamingFolderId(null);
    setRenamingFolderName('');
    const { folderId: nextFolderId } = await loadMeta(folderId);
    await loadMessages(nextFolderId);
    setStatus(`已重命名文件夹：${renamed.name}`);
  }

  async function deleteCustomFolderConfirmed(folder: Folder) {
    await invoke('delete_custom_folder', { folderId: folder.id });
    const inboxFolderId = visibleFolderIdForRole('inbox', folder.account_id);
    const { folderId: nextFolderId } = await loadMeta(folderId === folder.id ? inboxFolderId : folderId);
    await loadMessages(nextFolderId);
    setStatus(`已删除文件夹：${folder.name}，其中邮件已移回收件箱`);
  }

  function deleteCustomFolder(folder: Folder) {
    setConfirmDeleteFolder(folder);
  }

  async function markFolderRead(folder: Folder) {
    const visibleUnreadCount = folder.unread_count;
    const report = await invoke<FolderReadReport>('mark_folder_read', {
      folderId: folder.id,
      role: folder.role,
      isVirtual: folder.is_virtual,
    });
    await refreshAll();
    setStatus(
      report.updated_count > 0 || visibleUnreadCount <= 0
        ? report.message
        : `已将 ${visibleUnreadCount} 封邮件标为已读；本地状态已刷新。`,
    );
  }

  return {
    customFolderName,
    setCustomFolderName,
    renamingFolderId,
    setRenamingFolderId,
    renamingFolderName,
    setRenamingFolderName,
    confirmDeleteFolder,
    setConfirmDeleteFolder,
    createCustomFolder,
    startRenameCustomFolder,
    renameCustomFolder,
    deleteCustomFolderConfirmed,
    deleteCustomFolder,
    markFolderRead,
  };
}
