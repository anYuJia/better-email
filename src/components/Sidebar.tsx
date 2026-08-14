import React from 'react';
import {
  Edit3,
  Keyboard,
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
  backgroundTasks: BackgroundTask[];
  savedSearchName: string;
  savedSearches: SavedSearch[];
  customFolderName: string;
  onAccountScopeChange: (value: string) => void;
  onSetDefaultAccount: (accountId: number) => void;
  onCompose: () => void;
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
};

function syncTaskLabel(task: BackgroundTask): string {
  if (task.status === 'queued') return '正在等待同步';

  const message = task.message;
  const bodyFolder = message.match(/正在获取\s+(.+?)\s+正文/)?.[1];
  const folderName = bodyFolder
    ?? message.match(/正在同步文件夹\s+\d+\/\d+（(.+?)）/)?.[1];
  const messageProgress = message.match(/已处理\s+(\d+)\s*\/\s*(\d+)/);
  const folderProgress = message.match(/文件夹\s+(\d+)\s*\/\s*(\d+)/)
    ?? message.match(/正在同步第\s+(\d+)\s*\/\s*(\d+)\s*个账号/);
  const progress = messageProgress ?? folderProgress;
  const count = progress ? ` ${progress[1]}/${progress[2]}` : '';

  if (folderName) return `正在同步${syncFolderDisplayName(folderName)}${count}`;
  if (message.includes('正在发现文件夹')) return '正在准备同步';
  return `正在同步邮件${count}`;
}

function outboxTaskLabel(task: BackgroundTask): string {
  if (task.status === 'queued') return `${task.title}已入队`;
  if (task.message) return task.message;
  return `正在${task.title}`;
}

function visibleTaskLabel(task: BackgroundTask): string {
  if (task.kind === 'sync') return syncTaskLabel(task);
  if (task.kind === 'outbox-smtp') return outboxTaskLabel(task);
  return task.title;
}

function isVisibleTask(task: BackgroundTask): boolean {
  return ['sync', 'outbox-smtp'].includes(task.kind)
    && (task.status === 'running' || task.status === 'queued');
}

function syncFolderDisplayName(folderName: string): string {
  const normalized = folderName.trim().toLowerCase();
  if (normalized === 'inbox') return '收件箱';
  if (normalized.includes('sent')) return '已发送';
  if (normalized.includes('draft')) return '草稿箱';
  if (normalized.includes('archive') || normalized.includes('all mail')) return '归档';
  if (normalized.includes('trash') || normalized.includes('deleted')) return '废纸篓';
  if (normalized.includes('junk') || normalized.includes('spam')) return '垃圾邮件';
  return /[\u4e00-\u9fff]/.test(folderName) ? folderName.trim() : '邮件';
}

function Sidebar({
  accountScope,
  accounts,
  folders,
  folderId,
  renamingFolderId,
  renamingFolderName,
  backgroundTasks,
  savedSearchName,
  savedSearches,
  customFolderName,
  onAccountScopeChange,
  onSetDefaultAccount,
  onCompose,
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
}: SidebarProps) {
  const activeTasks = backgroundTasks.filter(isVisibleTask);

  return (
    <aside className="sidebar">
      <div className="brand">
        <img
          className="brand-mark"
          src="/brand/v4/brand-mark.png"
          alt=""
          width={28}
          height={28}
          draggable={false}
        />
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

      <div className={`sidebar-footer${activeTasks.length > 0 ? ' has-sync-status' : ''}`}>
        {activeTasks.length > 0 && (
          <div className="sidebar-task-stack" role="status" aria-live="polite">
            {activeTasks.map((task) => {
              const label = visibleTaskLabel(task);
              const progress = Math.min(100, Math.max(0, task.progress));
              return (
                <div className="sidebar-task-item" key={task.id}>
                  <span className="sidebar-task-title">{label}</span>
                  <div
                    className="sidebar-task-progress"
                    role="progressbar"
                    aria-label={`${label}进度`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  {task.status === 'queued' && (
                    <small className="sidebar-task-status">等待开始</small>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="sidebar-footer-actions">
          <button
            className="settings-button"
            data-no-tooltip
            onClick={onOpenSettings}
          >
            <Settings size={17} /> <span>设置</span>
          </button>
          <button
            className="settings-button shortcut-help-button"
            data-no-tooltip
            onClick={onOpenShortcuts}
          >
            <Keyboard size={17} /> <span>快捷键</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

export default React.memo(Sidebar);
