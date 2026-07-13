import {
  Edit3,
  Keyboard,
  Search,
  Settings,
} from 'lucide-react';
import type {
  Account,
  AccountScope,
  BackgroundTask,
  Folder,
  SavedSearch,
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
  backgroundSyncStatus: string;
  backgroundTasks: BackgroundTask[];
  savedSearchName: string;
  savedSearches: SavedSearch[];
  customFolderName: string;
  onAccountScopeChange: (value: string) => void;
  onSetDefaultAccount: (accountId: number) => void;
  onCompose: () => void;
  onSyncNow: () => void;
  onResetAppLayout: () => void;
  onSavedSearchNameChange: (value: string) => void;
  onSaveCurrentSearch: () => void;
  onRunSavedSearch: (savedSearch: SavedSearch) => void;
  onDeleteSavedSearch: (savedSearch: SavedSearch) => void;
  onCustomFolderNameChange: (value: string) => void;
  onCreateCustomFolder: () => void;
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
  backgroundSyncStatus,
  backgroundTasks,
  savedSearchName,
  savedSearches,
  customFolderName,
  onAccountScopeChange,
  onSetDefaultAccount,
  onCompose,
  onSyncNow,
  onResetAppLayout,
  onSavedSearchNameChange,
  onSaveCurrentSearch,
  onRunSavedSearch,
  onDeleteSavedSearch,
  onCustomFolderNameChange,
  onCreateCustomFolder,
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
      >
        <details className="background-sync-card">
          <summary>
            <span>同步与布局</span>
            <small>{backgroundSyncStatus}</small>
          </summary>
          <span>后台任务</span>
          <em>
            {backgroundTasks.length > 0
              ? `${backgroundTasks.filter((task) => task.status === 'queued').length} 个排队`
              : '暂无后台任务'}
          </em>
          {backgroundTasks.length > 0 && (
            <div className="task-stack">
              {backgroundTasks.slice(0, 3).map((task) => (
                <small key={task.id}>{task.title} · {task.status}</small>
              ))}
            </div>
          )}
          <div className="sidebar-utility-actions">
            <button type="button" onClick={onSyncNow}>同步</button>
            <button type="button" onClick={onResetAppLayout}>重置布局</button>
          </div>
        </details>

        {import.meta.env.VITE_BETTER_EMAIL_UI_MOCK === '1' && (
          <details className="sidebar-tools">
            <summary>工具</summary>
            <div className="sidebar-tool-stack">
              <form
                className="saved-search-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSaveCurrentSearch();
                }}
              >
                <input
                  value={savedSearchName}
                  placeholder="保存当前搜索"
                  onChange={(event) => onSavedSearchNameChange(event.target.value)}
                />
                <button type="submit">保存</button>
              </form>
              {savedSearches.length > 0 && (
                <div className="saved-search-list">
                  {savedSearches.map((savedSearch) => (
                    <span key={savedSearch.id}>
                      <button type="button" onClick={() => onRunSavedSearch(savedSearch)}>
                        {savedSearch.name}
                      </button>
                      <button type="button" aria-label={`删除保存搜索 ${savedSearch.name}`} onClick={() => onDeleteSavedSearch(savedSearch)}>
                        删除
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <form
                className="custom-folder-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onCreateCustomFolder();
                }}
              >
                <input
                  value={customFolderName}
                  placeholder="新建文件夹"
                  onChange={(event) => onCustomFolderNameChange(event.target.value)}
                />
                <button type="submit">添加</button>
              </form>
            </div>
          </details>
        )}
      </SidebarFolderNavigation>

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
