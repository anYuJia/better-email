import {
  FileDown,
  FileUp,
  History,
  Merge,
  Pencil,
  Search,
  Send,
  Star,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  Contact,
  ContactCreateInput,
} from '../../app/types';
import {
  emptyContactAliasIssues,
  formatContactAliasIssues,
  validateContactAliases,
} from '../../app/uiConfig';
import useContactImportManager from '../../hooks/useContactImportManager';
import { CustomSelect } from './accounts/CustomSelect';
import ContactImportDialog from './ContactImportDialog';
import ContactImportHistoryDialog from './ContactImportHistoryDialog';
import {
  SettingsBadge,
  SettingsButton,
  SettingsEmptyState,
  SettingsField,
  SettingsSection,
  SettingsSwitch,
} from './shared';

type ContactAutomationSettingsProps = {
  contactForm: ContactCreateInput;
  contactFormAliases: string;
  contacts: Contact[];
  filteredContacts: Contact[];
  contactQuery: string;
  editingContactId: number | null;
  editName: string;
  editAliases: string;
  mergeSourceContactId: number | null;
  transferBusy: boolean;
  onContactFormChange: (contact: ContactCreateInput) => void;
  onContactFormAliasesChange: (value: string) => void;
  onContactQueryChange: (value: string) => void;
  onCreateContact: () => void;
  onEditNameChange: (value: string) => void;
  onEditAliasesChange: (value: string) => void;
  onSaveContactOverride: (contact: Contact) => void;
  onCancelEdit: () => void;
  onComposeToContact: (contact: Contact) => void;
  onStartEditContact: (contact: Contact) => void;
  onToggleContactVip: (contact: Contact) => void;
  onMergeContact: (contact: Contact) => void;
  onDeleteContact: (contact: Contact) => void;
  onMergeSourceChange: (contactId: number | null) => void;
  onExportContacts: () => void;
  onRefreshContacts: () => Promise<Contact[]>;
  onStatus: Dispatch<SetStateAction<string>>;
};

export default function ContactAutomationSettings({
  contactForm,
  contactFormAliases,
  contacts,
  filteredContacts,
  contactQuery,
  editingContactId,
  editName,
  editAliases,
  mergeSourceContactId,
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
  onMergeContact,
  onDeleteContact,
  onMergeSourceChange,
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
    batches,
    refreshBatches,
    undoBatch,
    undoingBatchId,
    confirmUndoBatch,
    setConfirmUndoBatch,
  } = useContactImportManager({ setStatus: onStatus });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  useEffect(() => {
    void refreshBatches();
  }, [refreshBatches]);

  async function handleCommitImport() {
    await commitImport();
    await onRefreshContacts();
  }

  function handleCloseImport() {
    cancelImport();
    setImportDialogOpen(false);
  }

  function handleCloseHistory() {
    setHistoryDialogOpen(false);
    void refreshBatches();
  }

  const contactAliasIssues = useMemo(() => {
    const takenByOther = new Set<string>();
    for (const contact of contacts) {
      takenByOther.add(contact.email.trim().toLowerCase());
      for (const alias of contact.aliases) takenByOther.add(alias.trim().toLowerCase());
    }
    return validateContactAliases(contactFormAliases, contactForm.email, takenByOther);
  }, [contactFormAliases, contactForm.email, contacts]);

  const editAliasIssues = useMemo(() => {
    const editing = contacts.find((contact) => contact.id === editingContactId);
    if (!editing) return emptyContactAliasIssues;
    const takenByOther = new Set<string>();
    for (const contact of contacts) {
      if (contact.id === editing.id) continue;
      takenByOther.add(contact.email.trim().toLowerCase());
      for (const alias of contact.aliases) takenByOther.add(alias.trim().toLowerCase());
    }
    return validateContactAliases(editAliases, editing.email, takenByOther);
  }, [editAliases, editingContactId, contacts]);

  const aliasIssueText = formatContactAliasIssues(contactAliasIssues);
  const editAliasIssueText = formatContactAliasIssues(editAliasIssues);

  return (
    <SettingsSection
      title="联系人管理"
      description="别名、VIP、重复合并和快捷写信"
      actions={
        <div className="contact-transfer-actions">
          <SettingsBadge tone="neutral">{contacts.length} 位联系人</SettingsBadge>
          <SettingsButton
            size="sm"
            disabled={transferBusy}
            title="导入 vCard（.vcf / .vcard）或 CSV（.csv）联系人"
            icon={<FileUp size={14} />}
            onClick={() => setImportDialogOpen(true)}
          >
            导入联系人
          </SettingsButton>
          <SettingsButton size="sm" disabled={transferBusy || contacts.length === 0} icon={<FileDown size={14} />} onClick={onExportContacts}>
            导出 vCard
          </SettingsButton>
          <SettingsButton
            size="sm"
            variant="ghost"
            className="contact-history-toggle"
            aria-label="最近导入记录"
            title="最近导入记录"
            icon={<History size={14} />}
            onClick={() => setHistoryDialogOpen(true)}
          />
        </div>
      }
      dataSection="contacts"
    >

      <div className="contact-create-form settings-contact-create">
        <SettingsField label="联系人名称">
          <input
            value={contactForm.name}
            onChange={(event) => onContactFormChange({ ...contactForm, name: event.target.value })}
            placeholder="联系人名称"
          />
        </SettingsField>
        <SettingsField label="邮箱地址">
          <input
            value={contactForm.email}
            onChange={(event) => onContactFormChange({ ...contactForm, email: event.target.value })}
            placeholder="邮箱地址"
          />
        </SettingsField>
        <SettingsField label="别名邮箱" hint={aliasIssueText || undefined}>
          <textarea
            value={contactFormAliases}
            onChange={(event) => onContactFormAliasesChange(event.target.value)}
            placeholder="别名邮箱，逗号、分号或换行分隔"
          />
        </SettingsField>
        <SettingsSwitch
          label="设为 VIP"
          description="可配合通知策略只提醒重要联系人"
          checked={contactForm.vip}
          onChange={(checked) => onContactFormChange({ ...contactForm, vip: checked })}
        />
        <SettingsButton variant="primary" icon={<UserPlus size={14} />} onClick={onCreateContact}>
          新增联系人
        </SettingsButton>
      </div>

      {contacts.length === 0 ? (
        <SettingsEmptyState>
          还没有联系人。可以手动新增，或从 vCard（.vcf）/ CSV（.csv）文件导入。
        </SettingsEmptyState>
      ) : (
        <div className="settings-contact-list">
          <SettingsField label="搜索联系人">
            <div className="settings-contact-search">
              <Search size={14} aria-hidden="true" />
              <input
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
          {filteredContacts.map((contact) => (
            <div className="st-data-row contact-tool-row" key={contact.id}>
              {editingContactId === contact.id ? (
                <div className="contact-edit-form">
                  <input
                    value={editName}
                    onChange={(event) => onEditNameChange(event.target.value)}
                    placeholder="联系人名称"
                  />
                  <div>
                    <textarea
                      value={editAliases}
                      onChange={(event) => onEditAliasesChange(event.target.value)}
                      placeholder="别名邮箱，逗号、分号或换行分隔"
                    />
                    {editAliasIssueText && (
                      <p className="contact-alias-warning">{editAliasIssueText}</p>
                    )}
                  </div>
                  <div className="st-actions">
                    <SettingsButton size="sm" variant="primary" onClick={() => onSaveContactOverride(contact)}>保存</SettingsButton>
                    <SettingsButton size="sm" onClick={onCancelEdit}>取消</SettingsButton>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className="settings-contact-main" onClick={() => onComposeToContact(contact)}>
                    <Send size={14} />
                    <span>
                      <strong>{contact.vip ? '★ ' : ''}{contact.name || contact.email}</strong>
                      <em>{contact.email}</em>
                      {contact.aliases.length > 0 && (
                        <span className="contact-alias-chips">
                          {contact.aliases.slice(0, 4).map((alias) => (
                            <span key={alias}>{alias}</span>
                          ))}
                          {contact.aliases.length > 4 && (
                            <span>+{contact.aliases.length - 4}</span>
                          )}
                        </span>
                      )}
                      <small>{contact.message_count} 封往来</small>
                    </span>
                  </button>
                  <div className="contact-tool-actions">
                    <SettingsButton
                      size="sm"
                      variant="ghost"
                      aria-label={`编辑 ${contact.name || contact.email}`}
                      title="编辑联系人"
                      icon={<Pencil size={13} />}
                      onClick={() => onStartEditContact(contact)}
                    >
                      <span className="contact-action-label">编辑</span>
                    </SettingsButton>
                    <SettingsButton
                      size="sm"
                      variant="ghost"
                      aria-label={`${contact.vip ? '取消 VIP' : '设为 VIP'} ${contact.name || contact.email}`}
                      title={contact.vip ? '取消 VIP' : '设为 VIP'}
                      icon={<Star size={13} />}
                      onClick={() => onToggleContactVip(contact)}
                    >
                      <span className="contact-action-label">{contact.vip ? '取消 VIP' : '设为 VIP'}</span>
                    </SettingsButton>
                    <SettingsButton
                      size="sm"
                      variant="ghost"
                      aria-label={`合并 ${contact.name || contact.email}`}
                      title="合并联系人"
                      icon={<Merge size={13} />}
                      onClick={() => onMergeContact(contact)}
                    >
                      <span className="contact-action-label">合并</span>
                    </SettingsButton>
                    <SettingsButton
                      size="sm"
                      variant="danger-secondary"
                      aria-label={`删除 ${contact.name || contact.email}`}
                      title="删除联系人"
                      icon={<Trash2 size={13} />}
                      onClick={() => onDeleteContact(contact)}
                    >
                      <span className="contact-action-label">删除</span>
                    </SettingsButton>
                  </div>
                </>
              )}
            </div>
          ))}
          {filteredContacts.length === 0 && contactQuery && (
            <p className="settings-empty-hint">没有匹配「{contactQuery}」的联系人。</p>
          )}
        </div>
      )}

      <SettingsField label="合并来源">
        <CustomSelect
          ariaLabel="合并来源"
          value={mergeSourceContactId !== null ? String(mergeSourceContactId) : ''}
          options={[
            { value: '', label: '选择一个联系人' },
            ...contacts.map((contact) => ({
              value: String(contact.id),
              label: `${contact.name || contact.email} · ${contact.email}`,
            })),
          ]}
          onChange={(nextValue) => onMergeSourceChange(nextValue ? Number(nextValue) : null)}
        />
      </SettingsField>

      {confirmUndoBatch && (
        <div className="settings-cache-confirm-backdrop">
          <div className="settings-cache-confirm" role="dialog" aria-modal="true">
            <strong>撤销导入批次</strong>
            <p>
              将删除「{confirmUndoBatch.file_name}」批次新增的 {confirmUndoBatch.created_count} 位联系人。
              合并/更新已有联系人的变更不可回滚。
            </p>
            <div className="st-actions">
              <SettingsButton onClick={() => setConfirmUndoBatch(null)}>取消</SettingsButton>
              <SettingsButton
                variant="danger"
                disabled={undoingBatchId === confirmUndoBatch.id}
                onClick={() => { void undoBatch(confirmUndoBatch.id); void onRefreshContacts(); }}
              >
                {undoingBatchId === confirmUndoBatch.id ? '撤销中…' : '确认撤销'}
              </SettingsButton>
            </div>
          </div>
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
        onSetSelection={setSelection}
        onSetAllSelection={setAllSelection}
        onSetEntryEdit={setEntryEdit}
        onPickFile={() => { void startImport(); }}
        onConfirm={() => { void handleCommitImport(); }}
        onCancel={handleCloseImport}
        onOpenHistory={() => {
          setImportDialogOpen(false);
          setHistoryDialogOpen(true);
          void refreshBatches();
        }}
      />

      <ContactImportHistoryDialog
        open={historyDialogOpen}
        batches={batches}
        undoingBatchId={undoingBatchId}
        onUndo={(batch) => setConfirmUndoBatch(batch)}
        onClose={handleCloseHistory}
      />
    </SettingsSection>
  );
}
