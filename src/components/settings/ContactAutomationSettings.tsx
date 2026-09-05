import {
  FileDown,
  FileUp,
  Pencil,
  Search,
  Send,
  Star,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  Account,
  AccountScope,
  Contact,
  ContactCreateInput,
} from '../../app/types';
import {
  emptyContactAliasIssues,
  formatContactAliasIssues,
  isValidEmailAddress,
  validateContactAliases,
} from '../../app/uiConfig';
import useContactImportManager from '../../hooks/useContactImportManager';
import ContactImportDialog from './ContactImportDialog';
import {
  SettingsBadge,
  SettingsButton,
  AccountScopeRequired,
  SettingsEmptyState,
  SettingsField,
  SettingsSection,
  SettingsSwitch,
} from './shared';

const FOCUSABLE_SELECTOR = 'button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function contactInitial(contact: Contact) {
  const source = contact.name.trim() || contact.email.trim();
  return Array.from(source)[0]?.toLocaleUpperCase() ?? '?';
}

type ContactAutomationSettingsProps = {
  accounts?: Account[];
  accountScope?: AccountScope;
  onSelectAccount?: (account: Account) => void;
  contactForm: ContactCreateInput;
  contactFormAliases: string;
  contacts: Contact[];
  filteredContacts: Contact[];
  contactQuery: string;
  editingContactId: number | null;
  editName: string;
  editAliases: string;
  transferBusy: boolean;
  onContactFormChange: (contact: ContactCreateInput) => void;
  onContactFormAliasesChange: (value: string) => void;
  onContactQueryChange: (value: string) => void;
  onCreateContact: () => Promise<void>;
  onEditNameChange: (value: string) => void;
  onEditAliasesChange: (value: string) => void;
  onSaveContactOverride: (contact: Contact) => void | Promise<void>;
  onCancelEdit: () => void;
  onComposeToContact: (contact: Contact) => void;
  onStartEditContact: (contact: Contact) => void;
  onToggleContactVip: (contact: Contact) => void;
  onDeleteContact: (contact: Contact) => void;
  onExportContacts: () => void;
  onRefreshContacts: () => Promise<Contact[]>;
  onStatus: Dispatch<SetStateAction<string>>;
};

export default function ContactAutomationSettings({
  accounts = [],
  accountScope = 1,
  onSelectAccount,
  contactForm,
  contactFormAliases,
  contacts,
  filteredContacts,
  contactQuery,
  editingContactId,
  editName,
  editAliases,
  transferBusy,
  onContactFormChange,
  onContactFormAliasesChange,
  onContactQueryChange,
  onCreateContact,
  onEditNameChange,
  onEditAliasesChange,
  onSaveContactOverride,
  onCancelEdit,
  onComposeToContact,
  onStartEditContact,
  onToggleContactVip,
  onDeleteContact,
  onExportContacts,
  onRefreshContacts,
  onStatus,
}: ContactAutomationSettingsProps) {
  const {
    preview,
    commitResult,
    selectionMap,
    entryEdits,
    setEntryEdit,
    setSelection,
    setAllSelection,
    previewing,
    importing,
    startImport,
    commitImport,
    cancelImport,
    importError,
  } = useContactImportManager({
    setStatus: onStatus,
    accountId: accountScope === 'all' ? null : accountScope,
  });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [dialog, setDialog] = useState<'create' | 'details' | 'edit' | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [page, setPage] = useState(1);
  const dialogRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pageSize = 8;
  const visibleContacts = useMemo(
    () => typeof accountScope === 'number'
      ? contacts.filter((contact) => contact.account_id === accountScope)
      : contacts,
    [accountScope, contacts],
  );
  const visibleFilteredContacts = useMemo(
    () => typeof accountScope === 'number'
      ? filteredContacts.filter((contact) => contact.account_id === accountScope)
      : filteredContacts,
    [accountScope, filteredContacts],
  );

  useEffect(() => {
    setPage(1);
  }, [contactQuery]);

  useEffect(() => {
    if (!dialog) return undefined;
    const focusSelector = dialog === 'details'
      ? '.settings-contact-dialog-close'
      : dialog === 'edit'
        ? '#contact-edit-name'
        : 'input:not([readonly]), textarea, button:not(.settings-contact-dialog-close)';
    const focusTarget = dialogRef.current?.querySelector<HTMLElement>(focusSelector);
    focusTarget?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeContactDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialog]);

  const pageCount = Math.max(1, Math.ceil(visibleFilteredContacts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedContacts = visibleFilteredContacts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const vipCount = visibleContacts.filter((contact) => contact.vip).length;

  async function handleCommitImport() {
    await commitImport();
    await onRefreshContacts();
  }

  function handleCloseImport() {
    cancelImport();
    setImportDialogOpen(false);
  }

  const contactAliasIssues = useMemo(() => {
    const takenByOther = new Set<string>();
    for (const contact of visibleContacts) {
      takenByOther.add(contact.email.trim().toLowerCase());
      for (const alias of contact.aliases) takenByOther.add(alias.trim().toLowerCase());
    }
    return validateContactAliases(contactFormAliases, contactForm.email, takenByOther);
  }, [contactFormAliases, contactForm.email, visibleContacts]);

  const editAliasIssues = useMemo(() => {
    const editing = visibleContacts.find((contact) => contact.id === editingContactId);
    if (!editing) return emptyContactAliasIssues;
    const takenByOther = new Set<string>();
    for (const contact of visibleContacts) {
      if (contact.id === editing.id) continue;
      takenByOther.add(contact.email.trim().toLowerCase());
      for (const alias of contact.aliases) takenByOther.add(alias.trim().toLowerCase());
    }
    return validateContactAliases(editAliases, editing.email, takenByOther);
  }, [editAliases, editingContactId, visibleContacts]);

  const aliasIssueText = formatContactAliasIssues(contactAliasIssues);
  const editAliasIssueText = formatContactAliasIssues(editAliasIssues);

  if (accountScope === 'all') {
    return (
      <AccountScopeRequired
        accountScope={accountScope}
        accounts={accounts}
        onSelectAccount={onSelectAccount}
        title="请选择具体邮箱账号"
        description="联系人、VIP、别名和导入记录都属于单独邮箱账号。请从下方选择账号或使用顶部的邮箱范围选择器继续。"
      />
    );
  }

  async function handleCreateContact() {
    const email = contactForm.email.trim();
    if (!email) {
      setCreateError('请输入联系人邮箱。');
      return false;
    }
    if (!isValidEmailAddress(email)) {
      setCreateError('请输入有效的联系人邮箱地址。');
      return false;
    }
    if (contactAliasIssues.invalid.length > 0 || contactAliasIssues.duplicatesWithin.length > 0 || contactAliasIssues.takenByOther.length > 0) {
      setCreateError(`请先修正别名：${aliasIssueText}`);
      return false;
    }
    setCreateError('');
    try {
      await onCreateContact();
      closeContactDialog();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error:\s*/i, '') : String(error);
      setCreateError(message || '无法新增联系人，请稍后重试。');
      return false;
    }
  }

  function openDetails(contact: Contact) {
    triggerRef.current = document.activeElement as HTMLElement;
    setCreateError('');
    setSelectedContact(contact);
    setDialog('details');
  }

  function openEdit(contact: Contact) {
    if (dialog === null) {
      triggerRef.current = document.activeElement as HTMLElement;
    }
    setCreateError('');
    onStartEditContact(contact);
    setSelectedContact(contact);
    setDialog('edit');
  }

  function closeContactDialog() {
    setDialog(null);
    setSelectedContact(null);
    setCreateError('');
    onCancelEdit();
    triggerRef.current?.focus();
  }

  function toggleDetailVip(contact: Contact) {
    onToggleContactVip(contact);
    setSelectedContact({ ...contact, vip: !contact.vip });
  }

  return (
    <SettingsSection
      title="联系人管理"
      description="别名、VIP和快捷写信"
      actions={
        <div className="contact-primary-actions">
          <SettingsBadge tone="neutral">{visibleContacts.length} 位联系人</SettingsBadge>
          <SettingsButton size="sm" variant="primary" icon={<UserPlus size={14} />} onClick={() => { triggerRef.current = document.activeElement as HTMLElement; setDialog('create'); }}>
            添加联系人
          </SettingsButton>
        </div>
      }
      dataSection="contacts"
    >
      <div className="contact-transfer-actions" role="group" aria-label="联系人导入与导出">
        <SettingsButton
          size="sm"
          disabled={transferBusy}
          title="导入联系人"
          icon={<FileUp size={14} />}
          onClick={() => setImportDialogOpen(true)}
        >
          导入联系人
        </SettingsButton>
        <SettingsButton size="sm" disabled={transferBusy || visibleContacts.length === 0} icon={<FileDown size={14} />} onClick={onExportContacts}>
          导出 vCard
        </SettingsButton>
      </div>

      {visibleContacts.length === 0 ? (
        <SettingsEmptyState className="settings-contacts-empty">
          <span className="settings-contacts-empty-mark" aria-hidden="true"><Users size={20} /></span>
          <strong>暂无联系人</strong>
          <p>添加常用联系人，写信时可快捷选择；或从 vCard 文件导入。</p>
        </SettingsEmptyState>
      ) : (
        <div className="settings-contact-list">
          <div className="settings-contact-list-toolbar">
            <SettingsField className="settings-contact-search-field" label="搜索联系人">
              <div className="settings-contact-search">
                <Search size={14} aria-hidden="true" />
                <input
                  aria-label="搜索联系人"
                  value={contactQuery}
                  onChange={(event) => onContactQueryChange(event.target.value)}
                  placeholder="名称、邮箱或别名"
                />
                {contactQuery && (
                  <button
                    type="button"
                    className="settings-contact-search-clear"
                    aria-label="清除搜索"
                    title="清除搜索"
                    onClick={() => onContactQueryChange('')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </SettingsField>
            <div className="settings-contact-list-summary" role="status" aria-live="polite">
              <span>{contactQuery ? '搜索结果' : '全部联系人'}</span>
              <strong>{visibleFilteredContacts.length}</strong>
              <span>位</span>
              {vipCount > 0 && (
                <>
                  <span className="settings-contact-list-summary-separator" aria-hidden="true">·</span>
                  <span><strong>{vipCount}</strong> 位 VIP</span>
                </>
              )}
            </div>
          </div>
          {pagedContacts.map((contact) => {
            const displayName = contact.name.trim() || contact.email;
            const hasDisplayName = Boolean(contact.name.trim());
            return (
              <div className="st-data-row contact-tool-row" key={contact.id}>
                <button type="button" className="settings-contact-main" onClick={() => openDetails(contact)}>
                  <span className="settings-contact-avatar" aria-hidden="true">{contactInitial(contact)}</span>
                  <span className="settings-contact-copy">
                    <span className="settings-contact-name-line">
                      <strong>{contact.vip ? '★ ' : ''}{displayName}</strong>
                      {contact.vip && <SettingsBadge tone="warning">VIP</SettingsBadge>}
                    </span>
                    {hasDisplayName && <span className="settings-contact-email">{contact.email}</span>}
                    <span className="settings-contact-meta">
                      {contact.aliases.length > 0 ? `${contact.aliases.length} 个别名` : '无别名'}
                      <span aria-hidden="true">·</span>
                      {contact.message_count} 封往来
                    </span>
                  </span>
                </button>
                <div className="contact-tool-actions">
                  <SettingsButton size="sm" variant="ghost" aria-label={`编辑 ${displayName}`} title="编辑联系人" icon={<Pencil size={13} />} onClick={() => openEdit(contact)}>
                    <span className="contact-action-label">编辑</span>
                  </SettingsButton>
                </div>
              </div>
            );
          })}
          {visibleFilteredContacts.length === 0 && contactQuery && (
            <p className="settings-empty-hint">没有匹配「{contactQuery}」的联系人。</p>
          )}
          {visibleFilteredContacts.length > pageSize && (
            <nav className="settings-contact-pagination" aria-label="联系人分页">
              <span>第 {currentPage} / {pageCount} 页，共 {visibleFilteredContacts.length} 位</span>
              <div>
                <SettingsButton size="sm" variant="ghost" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</SettingsButton>
                <SettingsButton size="sm" variant="ghost" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>下一页</SettingsButton>
              </div>
            </nav>
          )}
        </div>
      )}

      {dialog === 'create' && (
        <div className="settings-contact-dialog-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget) closeContactDialog();
        }}>
          <section ref={(node) => { dialogRef.current = node; }} className="settings-contact-dialog contact-create-form" role="dialog" aria-modal="true" aria-labelledby="contact-create-title">
            <header>
              <span className="settings-contact-dialog-mark"><UserPlus size={18} /></span>
              <span><strong id="contact-create-title">添加联系人</strong><small>填写姓名、邮箱和可选别名。</small></span>
              <button type="button" className="settings-contact-dialog-close" aria-label="关闭" onClick={closeContactDialog}><X size={17} /></button>
            </header>
            <div className="settings-contact-create-fields">
              <SettingsField label="联系人名称"><input value={contactForm.name} onChange={(event) => { setCreateError(''); onContactFormChange({ ...contactForm, name: event.target.value }); }} placeholder="联系人名称" /></SettingsField>
              <SettingsField label="邮箱地址"><input value={contactForm.email} onChange={(event) => { setCreateError(''); onContactFormChange({ ...contactForm, email: event.target.value }); }} placeholder="name@example.com" /></SettingsField>
            </div>
            <SettingsField className="settings-contact-aliases" label="别名邮箱" error={contactAliasIssues.invalid.length > 0 || contactAliasIssues.duplicatesWithin.length > 0 || contactAliasIssues.takenByOther.length > 0 ? aliasIssueText : undefined} hint={contactAliasIssues.invalid.length === 0 && contactAliasIssues.duplicatesWithin.length === 0 && contactAliasIssues.takenByOther.length === 0 ? '可用逗号、分号或换行分隔多个别名。' : undefined}>
              <textarea rows={2} value={contactFormAliases} onChange={(event) => { setCreateError(''); onContactFormAliasesChange(event.target.value); }} placeholder="alias@example.com" />
            </SettingsField>
            <SettingsSwitch label="设为 VIP" description="可配合通知策略只提醒重要联系人" checked={contactForm.vip} onChange={(vip) => { setCreateError(''); onContactFormChange({ ...contactForm, vip }); }} />
            {createError && <p className="settings-contact-save-error" role="alert">{createError}</p>}
            <footer><SettingsButton onClick={closeContactDialog}>取消</SettingsButton><SettingsButton variant="primary" icon={<UserPlus size={14} />} onClick={() => { void handleCreateContact(); }}>确认添加</SettingsButton></footer>
          </section>
        </div>
      )}

      {dialog === 'details' && selectedContact && (
        <div className="settings-contact-dialog-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget) closeContactDialog();
        }}>
          <section ref={(node) => { dialogRef.current = node; }} className="settings-contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-details-title">
            <header>
              <span className="settings-contact-dialog-mark"><Users size={18} /></span>
              <span><strong id="contact-details-title">{selectedContact.name || selectedContact.email}</strong><small>{selectedContact.vip ? 'VIP 联系人' : '联系人详情'}</small></span>
              <button type="button" className="settings-contact-dialog-close" aria-label="关闭" onClick={closeContactDialog}><X size={17} /></button>
            </header>
            <dl className="settings-contact-details">
              <div className="settings-contact-detail-primary">
                <dt>邮箱地址</dt>
                <dd>{selectedContact.email}</dd>
              </div>
              <div>
                <dt>别名邮箱</dt>
                <dd className={selectedContact.aliases.length === 0 ? 'settings-contact-detail-empty' : undefined}>
                  {selectedContact.aliases.length ? selectedContact.aliases.join('、') : '未设置'}
                </dd>
              </div>
              <div>
                <dt>往来邮件</dt>
                <dd>{selectedContact.message_count} 封</dd>
              </div>
            </dl>
            <footer className="settings-contact-detail-actions">
              <span className="settings-contact-detail-actions-danger">
                <SettingsButton size="sm" variant="danger-secondary" icon={<Trash2 size={14} />} onClick={() => { onDeleteContact(selectedContact); closeContactDialog(); }}>删除</SettingsButton>
              </span>
              <span className="settings-contact-detail-actions-primary">
                <SettingsButton variant="primary" icon={<Send size={14} />} onClick={() => onComposeToContact(selectedContact)}>写信</SettingsButton>
                <SettingsButton size="sm" variant="secondary" icon={<Star size={14} />} onClick={() => toggleDetailVip(selectedContact)}>{selectedContact.vip ? '取消 VIP' : '设为 VIP'}</SettingsButton>
                <SettingsButton size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => openEdit(selectedContact)}>编辑</SettingsButton>
              </span>
            </footer>
          </section>
        </div>
      )}

      {dialog === 'edit' && selectedContact && (
        <div className="settings-contact-dialog-backdrop" onClick={(event) => {
          if (event.target === event.currentTarget) closeContactDialog();
        }}>
          <section ref={(node) => { dialogRef.current = node; }} className="settings-contact-dialog contact-edit-form" role="dialog" aria-modal="true" aria-labelledby="contact-edit-title">
            <header><span className="settings-contact-dialog-mark"><Pencil size={18} /></span><span><strong id="contact-edit-title">编辑联系人</strong><small>修改显示名称与别名邮箱</small></span><button type="button" className="settings-contact-dialog-close" aria-label="关闭" onClick={closeContactDialog}><X size={17} /></button></header>
            <div className="settings-contact-edit-email" role="group" aria-label="主邮箱">
              <span className="settings-contact-edit-email-label">主邮箱</span>
              <strong className="settings-contact-edit-email-value">{selectedContact.email}</strong>
            </div>
            <SettingsField label="显示名称" htmlFor="contact-edit-name">
              <input id="contact-edit-name" value={editName} onChange={(event) => onEditNameChange(event.target.value)} placeholder="显示名称" />
            </SettingsField>
            <SettingsField label="别名邮箱" error={editAliasIssues.invalid.length > 0 || editAliasIssues.duplicatesWithin.length > 0 || editAliasIssues.takenByOther.length > 0 ? editAliasIssueText : undefined} hint={editAliasIssues.invalid.length === 0 && editAliasIssues.duplicatesWithin.length === 0 && editAliasIssues.takenByOther.length === 0 ? '可用逗号、分号或换行分隔多个别名。' : undefined}>
              <textarea rows={2} value={editAliases} onChange={(event) => onEditAliasesChange(event.target.value)} placeholder="alias@example.com" />
            </SettingsField>
            {createError && <p className="settings-contact-save-error" role="alert">{createError}</p>}
            <footer><SettingsButton onClick={closeContactDialog}>取消</SettingsButton><SettingsButton variant="primary" disabled={editAliasIssues.invalid.length > 0 || editAliasIssues.duplicatesWithin.length > 0 || editAliasIssues.takenByOther.length > 0} onClick={async () => { try { await onSaveContactOverride(selectedContact); closeContactDialog(); } catch (error) { setCreateError(error instanceof Error ? error.message : String(error)); } }}>保存</SettingsButton></footer>
          </section>
        </div>
      )}

      <ContactImportDialog
        open={importDialogOpen}
        preview={preview}
        commitResult={commitResult}
        selectionMap={selectionMap}
        entryEdits={entryEdits}
        previewing={previewing}
        importing={importing}
        importError={importError}
        onSetSelection={setSelection}
        onSetAllSelection={setAllSelection}
        onSetEntryEdit={setEntryEdit}
        onPickFile={() => { void startImport(); }}
        onConfirm={() => { void handleCommitImport(); }}
        onCancel={handleCloseImport}
      />
    </SettingsSection>
  );
}
