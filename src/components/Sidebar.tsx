import React from 'react';
import {
  Edit3,
  Keyboard,
  MailPlus,
  MoreHorizontal,
  Pencil,
  Search,
  Send,
  Settings,
  Star,
  Trash2,
} from 'lucide-react';
import { isCustomFolder } from '../app/appConfig';
import type {
  Account,
  AccountScope,
  BackgroundTask,
  Contact,
  Folder,
  Label,
  SavedSearch,
} from '../app/types';
import AccountSwitcher from './AccountSwitcher';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import SidebarFolderNavigation from './SidebarFolderNavigation';

export type SidebarProps = {
  accountScope: AccountScope;
  accounts: Account[];
  folders: Folder[];
  folderId: number | null;
  renamingFolderId: number | null;
  renamingFolderName: string;
  savedSearches: SavedSearch[];
  savedSearchName: string;
  contacts: Contact[];
  contactQuery: string;
  filteredContacts: Contact[];
  labels: Label[];
  customFolderName: string;
  backgroundTasks: BackgroundTask[];
  backgroundSyncStatus: string;
  lastNewMailNotice: string | null;
  notificationStatus: string;
  appBadgeStatus: string;
  onAccountScopeChange: (value: string) => void;
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
  onSavedSearchNameChange: (value: string) => void;
  onSaveCurrentSearch: () => void;
  onRunSavedSearch: (savedSearch: SavedSearch) => void;
  onDeleteSavedSearch: (savedSearch: SavedSearch) => void;
  onRunLabelSearch: (label: Label) => void;
  onContactQueryChange: (value: string) => void;
  onComposeToContact: (contact: Contact) => void;
  onAddContactToDraft: (contact: Contact) => void;
  onEditContact: (contact: Contact) => void;
  onToggleContactVip: (contact: Contact) => void;
  onDeleteContact: (contact: Contact) => void;
  onCustomFolderNameChange: (value: string) => void;
  onCreateCustomFolder: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onOpenCommandPalette: () => void;
  onSync: () => void;
  onResetLayout: () => void;
};

export default function Sidebar({
  accountScope,
  accounts,
  folders,
  folderId,
  renamingFolderId,
  renamingFolderName,
  savedSearches,
  savedSearchName,
  contacts,
  contactQuery,
  filteredContacts,
  labels,
  customFolderName,
  backgroundTasks,
  backgroundSyncStatus,
  lastNewMailNotice,
  notificationStatus,
  appBadgeStatus,
  onAccountScopeChange,
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
  onSavedSearchNameChange,
  onSaveCurrentSearch,
  onRunSavedSearch,
  onDeleteSavedSearch,
  onRunLabelSearch,
  onContactQueryChange,
  onComposeToContact,
  onAddContactToDraft,
  onEditContact,
  onToggleContactVip,
  onDeleteContact,
  onCustomFolderNameChange,
  onCreateCustomFolder,
  onOpenSettings,
  onOpenShortcuts,
  onOpenCommandPalette,
  onSync,
  onResetLayout,
}: SidebarProps) {
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    ariaLabel: string;
    title: string;
    detail?: string;
    items: ContextMenuItem[];
  } | null>(null);
  const customFolderCount = folders.filter(isCustomFolder).length;

  function openContactContextMenu(contact: Contact, x: number, y: number) {
    setContextMenu({
      x,
      y,
      ariaLabel: `${contact.name || contact.email} 联系人操作`,
      title: contact.name || contact.email,
      detail: contact.email,
      items: [
        {
          id: 'compose-contact',
          label: '写邮件',
          icon: <Send size={15} />,
          onSelect: () => onComposeToContact(contact),
        },
        {
          id: 'add-contact-draft',
          label: '加入当前草稿',
          icon: <MailPlus size={15} />,
          onSelect: () => onAddContactToDraft(contact),
        },
        {
          id: 'edit-contact',
          label: '编辑联系人',
          icon: <Pencil size={15} />,
          separatorBefore: true,
          onSelect: () => onEditContact(contact),
        },
        {
          id: 'toggle-contact-vip',
          label: contact.vip ? '取消 VIP' : '设为 VIP',
          icon: <Star size={15} />,
          checked: contact.vip,
          onSelect: () => onToggleContactVip(contact),
        },
        {
          id: 'delete-contact',
          label: '删除联系人',
          icon: <Trash2 size={15} />,
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
          <span>跨平台 · 本地优先</span>
        </div>
      </div>
      <AccountSwitcher
        accountScope={accountScope}
        accounts={accounts}
        onChange={onAccountScopeChange}
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
        <details className="sidebar-disclosure sidebar-tools">
          <summary>
            <span>工具</span>
            <em>4 项</em>
          </summary>
          <div className="sidebar-tool-stack">
            <section className="sidebar-tool-section saved-searches">
              <div className="sidebar-tool-heading">
                <strong>保存搜索</strong>
                <span>{savedSearches.length ? `${savedSearches.length} 个` : '保存常用条件'}</span>
              </div>
              <form
                className="saved-search-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSaveCurrentSearch();
                }}
              >
                <input
                  value={savedSearchName}
                  onChange={(event) => onSavedSearchNameChange(event.target.value)}
                  placeholder="搜索名称"
                />
                <button type="submit">保存</button>
              </form>
              <div className="saved-search-list">
                {savedSearches.map((savedSearch) => (
                  <div
                    className="saved-search-row"
                    key={savedSearch.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        ariaLabel: `${savedSearch.name} 搜索操作`,
                        title: savedSearch.name,
                        detail: savedSearch.query,
                        items: [
                          {
                            id: 'run-search',
                            label: '运行搜索',
                            icon: <Search size={15} />,
                            onSelect: () => onRunSavedSearch(savedSearch),
                          },
                          {
                            id: 'delete-search',
                            label: '删除保存搜索',
                            icon: <Trash2 size={15} />,
                            danger: true,
                            separatorBefore: true,
                            onSelect: () => onDeleteSavedSearch(savedSearch),
                          },
                        ],
                      });
                    }}
                  >
                    <button type="button" onClick={() => onRunSavedSearch(savedSearch)}>
                      <strong>{savedSearch.name}</strong>
                      <span>{savedSearch.query}</span>
                    </button>
                    <button
                      type="button"
                      className="row-more-button"
                      title="更多搜索操作"
                      aria-label={`${savedSearch.name} 更多操作`}
                      onClick={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setContextMenu({
                          x: bounds.right,
                          y: bounds.bottom,
                          ariaLabel: `${savedSearch.name} 搜索操作`,
                          title: savedSearch.name,
                          detail: savedSearch.query,
                          items: [
                            {
                              id: 'run-search',
                              label: '运行搜索',
                              icon: <Search size={15} />,
                              onSelect: () => onRunSavedSearch(savedSearch),
                            },
                            {
                              id: 'delete-search',
                              label: '删除保存搜索',
                              icon: <Trash2 size={15} />,
                              danger: true,
                              separatorBefore: true,
                              onSelect: () => onDeleteSavedSearch(savedSearch),
                            },
                          ],
                        });
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                ))}
                {savedSearches.length === 0 && <small>保存常用搜索条件</small>}
              </div>
            </section>

            <section className="sidebar-tool-section contact-center">
              <div className="sidebar-tool-heading">
                <strong>联系人</strong>
                <span>{contacts.length ? `${contacts.length} 位` : '自动收集'}</span>
              </div>
              <input
                value={contactQuery}
                onChange={(event) => onContactQueryChange(event.target.value)}
                placeholder="搜索联系人"
              />
              <div className="contact-list">
                {filteredContacts.map((contact) => (
                  <div
                    className="contact-row"
                    key={contact.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openContactContextMenu(contact, event.clientX, event.clientY);
                    }}
                  >
                    <button type="button" onClick={() => onComposeToContact(contact)}>
                      <strong>{contact.vip ? '★ ' : ''}{contact.name || contact.email}</strong>
                      <span>{contact.email}{contact.aliases.length ? ` · ${contact.aliases.length} 个别名` : ''}</span>
                    </button>
                    <button
                      type="button"
                      className="row-more-button"
                      title="更多联系人操作"
                      aria-label={`${contact.name || contact.email} 更多操作`}
                      onClick={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        openContactContextMenu(contact, bounds.right, bounds.bottom);
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                ))}
                {filteredContacts.length === 0 && <small>没有匹配联系人</small>}
              </div>
            </section>

            <section className="sidebar-tool-section label-section">
              <div className="sidebar-tool-heading">
                <strong>标签</strong>
                <span>{labels.length} 个</span>
              </div>
              <div className="label-list">
                {labels.map((label) => (
                  <div
                    className="label-row"
                    key={label.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContextMenu({
                        x: event.clientX,
                        y: event.clientY,
                        ariaLabel: `${label.name} 标签操作`,
                        title: label.name,
                        detail: `${label.message_count} 封邮件`,
                        items: [
                          {
                            id: 'search-label',
                            label: '查看此标签邮件',
                            icon: <Search size={15} />,
                            onSelect: () => onRunLabelSearch(label),
                          },
                        ],
                      });
                    }}
                  >
                    <button type="button" className="label-row-main" onClick={() => onRunLabelSearch(label)}>
                      <span className="label-dot" style={{ background: label.color }} />
                      <strong>{label.name}</strong>
                      <em>{label.message_count}</em>
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="sidebar-tool-section folder-manager">
              <div className="sidebar-tool-heading">
                <strong>文件夹</strong>
                <span>{customFolderCount ? `${customFolderCount} 个自定义` : '新建文件夹'}</span>
              </div>
              <form
                className="custom-folder-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onCreateCustomFolder();
                }}
              >
                <input
                  value={customFolderName}
                  onChange={(event) => onCustomFolderNameChange(event.target.value)}
                  placeholder="新建文件夹"
                />
                <button type="submit">添加</button>
              </form>
            </section>
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
        <details className="sidebar-disclosure background-sync-card">
          <summary>
            <span>同步与布局</span>
            <em>{backgroundTasks.some((task) => task.status === 'running') ? '同步中' : '就绪'}</em>
          </summary>
          <span>{backgroundSyncStatus}</span>
          {lastNewMailNotice && <em>{lastNewMailNotice}</em>}
          <small>{notificationStatus}</small>
          <small>{appBadgeStatus}</small>
          {backgroundTasks.length > 0 && (
            <div className="task-stack">
              {backgroundTasks.slice(0, 3).map((task) => (
                <small key={task.id}>
                  {task.title} · {task.status === 'queued' ? '排队' : task.status === 'running' ? '执行中' : task.status === 'done' ? '完成' : '失败'}
                </small>
              ))}
            </div>
          )}
          <div className="sidebar-utility-actions">
            <button type="button" onClick={onSync}>立即同步</button>
            <button className="layout-reset-button" type="button" onClick={onResetLayout}>重置布局</button>
          </div>
        </details>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          title={contextMenu.title}
          detail={contextMenu.detail}
          ariaLabel={contextMenu.ariaLabel}
          onClose={() => setContextMenu(null)}
        />
      )}
    </aside>
  );
}
