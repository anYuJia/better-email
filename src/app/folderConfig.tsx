import React from 'react';
import { Archive, Clock, Edit3, Inbox, Mail, Send, Trash2 } from 'lucide-react';
import type {
  Folder,
  FolderRole,
  MessageSummary,
  SystemFolderRole,
} from './types';

export function isCustomFolder(folder: Folder): boolean {
  return folder.role.startsWith('custom:');
}

export function folderPreferenceKey(folder: Folder): string {
  return `${folder.account_id ?? 'virtual'}:${folder.role}`;
}

export function isMovableMessageFolder(folder: Folder): boolean {
  return !folder.is_virtual && folder.role !== 'snoozed';
}

export function movableFoldersForMessage(folders: Folder[], message?: MessageSummary | null): Folder[] {
  return folders.filter((folder) => {
    if (!isMovableMessageFolder(folder)) return false;
    if (message && folder.account_id !== message.account_id) return false;
    if (message && folder.role === message.folder_role) return false;
    return true;
  });
}

export function movableFoldersForBulk(folders: Folder[], selectedMessages: MessageSummary[]): Folder[] {
  if (selectedMessages.length === 0) return [];
  const accountIds = new Set(selectedMessages.map((message) => message.account_id));
  if (accountIds.size !== 1) return [];
  return folders.filter((folder) => {
    if (!isMovableMessageFolder(folder)) return false;
    if (folder.account_id !== selectedMessages[0].account_id) return false;
    return selectedMessages.some((message) => message.folder_role !== folder.role);
  });
}

export const folderIcon: Record<SystemFolderRole, React.ReactNode> = {
  inbox: <Inbox size={17} />,
  sent: <Send size={17} />,
  drafts: <Edit3 size={17} />,
  outbox: <Send size={17} />,
  archive: <Archive size={17} />,
  trash: <Trash2 size={17} />,
  spam: <Mail size={17} />,
  snoozed: <Clock size={17} />,
  custom: <Mail size={17} />,
};

export function folderIconForRole(role: FolderRole): React.ReactNode {
  return folderIcon[role as SystemFolderRole] ?? folderIcon.custom;
}


export const primaryFolderRoles = new Set<FolderRole>(['inbox', 'sent', 'drafts', 'archive']);
