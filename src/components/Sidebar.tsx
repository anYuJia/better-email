import React from 'react';
import {
  Edit3,
  Keyboard,
  Search,
  Settings,
} from 'lucide-react';
import type {
  Account,
  AccountScope,
  Folder,
} from '../app/types';
import AccountSwitcher from './AccountSwitcher';
import SidebarFolderNavigation from './SidebarFolderNavigation';

export type SidebarProps = {
  accountScope: AccountScope;
  accounts: Account[];
  folders: Folder[];
  folderId: number | null;
  renamingFolderId: number | null;
  renamingFolderName: string;
  onAccountScopeChange: (value: string) => void;
  onSetDefaultAccount: (accountId: number) => void;
  onCompose: () => void;
  onSelectFolder: (folderId: number) => void;
  onDropMessagesToFolder: (folder: Folder, messageIds: number[]) => void;
  onFolderFavoriteChange: (folder: Folder, isFavorite: boolean) => void;
  onRenamingFolderNameChange: (value: string) => void;
  onRenameFolder: (folder: Folder) => void;
  onCancelRename: () => void;
  onStartRename: (folder: Folder) => void;
  onDeleteFolder: (folder: Folder) => void;
  onMarkFolderRead: (folder: Folder) => void;
  onEmptyTrash: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenCommandPalette: () => void;
};

export default function Sidebar({
  accountScope,
  accounts,
  folders,
  folderId,
  renamingFolderId,
  renamingFolderName,
  onAccountScopeChange,
  onSetDefaultAccount,
  onCompose,
  onSelectFolder,
  onDropMessagesToFolder,
  onFolderFavoriteChange,
  onRenamingFolderNameChange,
  onRenameFolder,
  onCancelRename,
  onStartRename,
  onDeleteFolder,
  onMarkFolderRead,
  onEmptyTrash,
  onOpenSettings,
  onOpenShortcuts,
  onOpenCommandPalette,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">B</div>
        <div>
          <strong>Better Email</strong>
        </div>
      </div>
      <AccountSwitcher
        accountScope={accountScope}
        accounts={accounts}
        onChange={onAccountScopeChange}
        onSetDefault={onSetDefaultAccount}
        onAddAccount={onOpenSettings}
      />
      <button className="compose-button" onClick={onCompose}>
        <Edit3 size={17} /> 写邮件
      </button>
      <SidebarFolderNavigation
        folders={folders}
        folderId={folderId}
        renamingFolderId={renamingFolderId}
        renamingFolderName={renamingFolderName}
        onSelectFolder={onSelectFolder}
        onDropMessagesToFolder={onDropMessagesToFolder}
        onRenamingFolderNameChange={onRenamingFolderNameChange}
        onRenameFolder={onRenameFolder}
        onCancelRename={onCancelRename}
        onStartRename={onStartRename}
        onDeleteFolder={onDeleteFolder}
        onMarkFolderRead={onMarkFolderRead}
        onEmptyTrash={onEmptyTrash}
        onFavoriteChange={onFolderFavoriteChange}
      />

      <div className="sidebar-footer">
        <div className="sidebar-footer-actions">
          <button className="settings-button" title="设置" onClick={onOpenSettings}>
            <Settings size={17} /> <span>设置</span>
          </button>
          <button className="settings-button shortcut-help-button" title="快捷键" onClick={onOpenShortcuts}>
            <Keyboard size={17} /> <span>快捷键</span>
          </button>
          <button className="settings-button command-palette-button" title="命令" onClick={onOpenCommandPalette}>
            <Search size={17} /> <span>命令</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
