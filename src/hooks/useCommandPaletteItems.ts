import { useMemo, type RefObject } from 'react';
import { filters, normalizeCommandSearchText } from '../app/appConfig';
import type {
  CommandPaletteItem,
  ComposeTemplate,
  Contact,
  FilterMode,
  Folder,
  Label,
  ListMode,
  Message,
} from '../app/types';

type ComposeMode = 'reply' | 'replyAll' | 'forward';

type UseCommandPaletteItemsOptions = {
  commandQuery: string;
  composeTemplates: ComposeTemplate[];
  managedContacts: Contact[];
  selected: Message | null;
  labels: Label[];
  folders: Folder[];
  filter: FilterMode;
  query: string;
  isComposerOpen: boolean;
  searchInputRef: RefObject<HTMLInputElement>;
  openComposer: () => void;
  refreshAll: () => Promise<void>;
  setListMode: (mode: ListMode) => void;
  clearActiveThread: () => void;
  openSettings: () => void;
  openShortcuts: () => void;
  setFilter: (filter: FilterMode) => void;
  applyComposeTemplate: (template: ComposeTemplate) => void;
  composeToContact: (contact: Contact) => void;
  composeFromMessage: (message: Message, mode: ComposeMode) => void;
  toggleRead: (message: Message) => Promise<void>;
  toggleStar: (message: Message) => Promise<void>;
  moveSelected: (role: 'archive' | 'trash') => Promise<void>;
  unsnoozeSelected: () => Promise<void>;
  snoozeSelected: () => Promise<void>;
  toggleLabel: (label: Label) => Promise<void>;
  openFolder: (folder: Folder, query: string, filter: FilterMode) => Promise<void>;
};

export default function useCommandPaletteItems({
  commandQuery,
  composeTemplates,
  managedContacts,
  selected,
  labels,
  folders,
  filter,
  query,
  isComposerOpen,
  searchInputRef,
  openComposer,
  refreshAll,
  setListMode,
  clearActiveThread,
  openSettings,
  openShortcuts,
  setFilter,
  applyComposeTemplate,
  composeToContact,
  composeFromMessage,
  toggleRead,
  toggleStar,
  moveSelected,
  unsnoozeSelected,
  snoozeSelected,
  toggleLabel,
  openFolder,
}: UseCommandPaletteItemsOptions) {
  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: 'compose',
        title: '写邮件',
        section: '常用',
        hint: '新建一封邮件',
        run: openComposer,
      },
      {
        id: 'refresh',
        title: '刷新邮箱',
        section: '常用',
        hint: '重新加载本地和同步状态',
        run: refreshAll,
      },
      {
        id: 'focus-search',
        title: '聚焦搜索',
        section: '导航',
        hint: '快速查找邮件',
        run: () => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        },
      },
      {
        id: 'messages-view',
        title: '显示邮件列表',
        section: '导航',
        hint: '切回单封邮件列表',
        run: () => {
          setListMode('messages');
          clearActiveThread();
        },
      },
      {
        id: 'threads-view',
        title: '显示会话线程',
        section: '导航',
        hint: '按会话聚合查看',
        run: () => setListMode('threads'),
      },
      {
        id: 'settings',
        title: '打开设置',
        section: '窗口',
        hint: '账号、安全、同步和规则',
        run: openSettings,
      },
      {
        id: 'shortcuts',
        title: '查看快捷键',
        section: '窗口',
        hint: '查看键盘操作',
        run: openShortcuts,
      },
      ...filters.map((item) => ({
        id: `filter-${item.id}`,
        title: `筛选：${item.label}`,
        section: '筛选',
        hint: item.id === 'all' ? '显示所有邮件' : `只显示${item.label}邮件`,
        run: () => setFilter(item.id),
      })),
      ...composeTemplates.map((template) => ({
        id: `compose-template-${template.id}`,
        title: `模板：${template.name}`,
        section: '写信',
        hint: template.subject || '插入模板正文',
        run: () => {
          if (!isComposerOpen) openComposer();
          applyComposeTemplate(template);
        },
      })),
      ...managedContacts.slice(0, 8).map((contact) => ({
        id: `contact-${contact.id}`,
        title: `写给：${contact.name || contact.email}`,
        section: '联系人',
        hint: `${contact.email} · ${contact.message_count} 封往来`,
        run: () => composeToContact(contact),
      })),
    ];

    if (selected) {
      items.push(
        {
          id: 'reply',
          title: '回复当前邮件',
          section: '当前邮件',
          hint: selected.subject || '(无主题)',
          disabled: selected.folder_role === 'drafts',
          run: () => composeFromMessage(selected, 'reply'),
        },
        {
          id: 'reply-all',
          title: '回复全部',
          section: '当前邮件',
          hint: selected.subject || '(无主题)',
          disabled: selected.folder_role === 'drafts',
          run: () => composeFromMessage(selected, 'replyAll'),
        },
        {
          id: 'forward',
          title: '转发当前邮件',
          section: '当前邮件',
          hint: selected.subject || '(无主题)',
          disabled: selected.folder_role === 'drafts',
          run: () => composeFromMessage(selected, 'forward'),
        },
        {
          id: 'toggle-read',
          title: selected.is_read ? '标为未读' : '标为已读',
          section: '当前邮件',
          hint: '切换阅读状态',
          run: () => toggleRead(selected),
        },
        {
          id: 'toggle-star',
          title: selected.is_starred ? '取消星标' : '添加星标',
          section: '当前邮件',
          hint: '切换星标',
          run: () => toggleStar(selected),
        },
        {
          id: 'archive',
          title: '归档当前邮件',
          section: '当前邮件',
          hint: '移到归档',
          disabled: selected.folder_role === 'trash',
          run: () => moveSelected('archive'),
        },
        {
          id: 'trash',
          title: '移到废纸篓',
          section: '当前邮件',
          hint: '删除但可恢复',
          disabled: selected.folder_role === 'trash',
          run: () => moveSelected('trash'),
        },
        {
          id: 'snooze',
          title: selected.folder_role === 'snoozed' ? '取消稍后处理' : '稍后处理',
          section: '当前邮件',
          hint: selected.folder_role === 'snoozed' ? '恢复到收件箱' : '选择提醒时间',
          disabled: selected.folder_role === 'trash',
          run: () => (selected.folder_role === 'snoozed' ? unsnoozeSelected() : snoozeSelected()),
        },
      );

      labels.forEach((label) => {
        items.push({
          id: `label-${label.id}`,
          title: selected.labels.includes(label.name) ? `移除标签：${label.name}` : `添加标签：${label.name}`,
          section: '标签',
          hint: `${label.message_count} 封邮件`,
          run: () => toggleLabel(label),
        });
      });
    }

    folders.forEach((folder) => {
      items.push({
        id: `folder-${folder.id}`,
        title: `打开：${folder.name}`,
        section: '邮箱',
        hint: folder.unread_count > 0 ? `${folder.unread_count} 未读` : '切换文件夹',
        run: () => openFolder(folder, query, filter),
      });
    });

    return items;
  }, [
    applyComposeTemplate,
    clearActiveThread,
    composeFromMessage,
    composeTemplates,
    composeToContact,
    filter,
    folders,
    isComposerOpen,
    labels,
    managedContacts,
    moveSelected,
    openComposer,
    openFolder,
    openSettings,
    openShortcuts,
    query,
    refreshAll,
    searchInputRef,
    selected,
    setFilter,
    setListMode,
    snoozeSelected,
    toggleLabel,
    toggleRead,
    toggleStar,
    unsnoozeSelected,
  ]);

  return useMemo(() => {
    const normalized = normalizeCommandSearchText(commandQuery);
    const items = normalized
      ? commandPaletteItems.filter((item) =>
          normalizeCommandSearchText(`${item.title} ${item.section} ${item.hint}`).includes(normalized),
        )
      : commandPaletteItems;
    return items.slice(0, 12);
  }, [commandPaletteItems, commandQuery]);
}
