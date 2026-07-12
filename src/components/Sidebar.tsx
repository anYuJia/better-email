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
  BackgroundTask,
  Contact,
  Folder,
  SavedSearch,
} from '../app/types';
import AccountSwitcher from './AccountSwitcher';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import {
  buildContactSearchEntries,
  matchingContacts,
} from './composer/contactSuggestions';
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
  contacts: Contact[];
  contactQuery: string;
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
  onContactQueryChange: (value: string) => void;
  onComposeToContact: (contact: Contact) => void;
  onEditContact: (contact: Contact) => void;
  onDeleteContact: (contact: Contact) => void;
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
  contacts,
  contactQuery,
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
  onContactQueryChange,
  onComposeToContact,
  onEditContact,
  onDeleteContact,
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
  const [contactContextMenu, setContactContextMenu] = React.useState<{
    x: number;
    y: number;
    title: string;
    detail: string;
    items: ContextMenuItem[];
  } | null>(null);
  const contactSearchEntries = React.useMemo(
    () => buildContactSearchEntries(contacts),
    [contacts],
  );
  const filteredContacts = React.useMemo(() => {
    return matchingContacts(contactSearchEntries, contactQuery, 6);
  }, [contactQuery, contactSearchEntries]);

  function openContactContextMenu(event: React.MouseEvent, contact: Contact) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setContactContextMenu({
      x: event.clientX || bounds.right,
      y: event.clientY || bounds.bottom,
      title: contact.name || contact.email,
      detail: contact.email,
      items: [
        {
          id: 'compose-contact',
          label: '写邮件',
          onSelect: () => onComposeToContact(contact),
        },
        {
          id: 'edit-contact',
          label: '编辑联系人',
          onSelect: () => onEditContact(contact),
        },
        {
          id: 'delete-contact',
          label: '删除联系人',
          danger: true,
          separatorBefore: true,
          onSelect: () => onDeleteContact(contact),
        },
      ],
    });
  }

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
      <section className="contact-center">
        <input
          value={contactQuery}
          placeholder="搜索联系人"
          onChange={(event) => onContactQueryChange(event.target.value)}
        />
        <div className="contact-list">
          {filteredContacts.length > 0 ? filteredContacts.map((contact) => (
            <div
              className="contact-row"
              key={contact.id}
              onContextMenu={(event) => openContactContextMenu(event, contact)}
            >
              <button type="button" onClick={() => onComposeToContact(contact)}>
                <strong>{contact.name || contact.email}</strong>
                <span>{contact.email}</span>
              </button>
              <button
                type="button"
                className="row-more-button"
                aria-label={`${contact.name || contact.email} 更多操作`}
                onClick={(event) => openContactContextMenu(event, contact)}
              >
                ···
              </button>
            </div>
          )) : (
            <small>暂无匹配联系人</small>
          )}
        </div>
      </section>
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
      {contactContextMenu && (
        <ContextMenu
          x={contactContextMenu.x}
          y={contactContextMenu.y}
          items={contactContextMenu.items}
          title={contactContextMenu.title}
          detail={contactContextMenu.detail}
          ariaLabel="联系人操作"
          onClose={() => setContactContextMenu(null)}
        />
      )}
    </aside>
  );
}
