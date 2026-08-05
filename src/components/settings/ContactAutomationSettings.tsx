import {
  Check,
  FileDown,
  FileUp,
  History,
  LoaderCircle,
  Merge,
  Pencil,
  Send,
  Star,
  Trash2,
  Undo2,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  Contact,
  ContactCreateInput,
} from '../../app/types';
import useContactImportManager from '../../hooks/useContactImportManager';
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
  editingContactId: number | null;
  editName: string;
  editAliases: string;
  mergeSourceContactId: number | null;
  transferBusy: boolean;
  onContactFormChange: (contact: ContactCreateInput) => void;
  onContactFormAliasesChange: (value: string) => void;
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
  onImportContacts: () => void;
  onExportContacts: () => void;
  onRefreshContacts: () => Promise<Contact[]>;
  onStatus: Dispatch<SetStateAction<string>>;
};

export default function ContactAutomationSettings({
  contactForm,
  contactFormAliases,
  contacts,
  editingContactId,
  editName,
  editAliases,
  mergeSourceContactId,
  transferBusy,
  onContactFormChange,
  onContactFormAliasesChange,
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
  onImportContacts,
  onExportContacts,
  onRefreshContacts,
  onStatus,
}: ContactAutomationSettingsProps) {
  const {
    preview,
    selectionMap,
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
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    void refreshBatches();
  }, [refreshBatches]);

  async function handleCommitImport() {
    await commitImport();
    await onRefreshContacts();
  }

  return (
    <SettingsSection
      title="联系人管理"
      description="别名、VIP、重复合并和快捷写信"
      actions={
        <div className="contact-transfer-actions">
          <SettingsBadge tone="neutral">{contacts.length} 位联系人</SettingsBadge>
          <SettingsButton
            size="sm"
            disabled={transferBusy || previewing}
            icon={previewing ? <LoaderCircle className="spinning" size={14} /> : <FileDown size={14} />}
            onClick={startImport}
          >
            导入联系人
          </SettingsButton>
          <SettingsButton size="sm" disabled={transferBusy || contacts.length === 0} icon={<FileUp size={14} />} onClick={onExportContacts}>
            导出 vCard
          </SettingsButton>
          <SettingsButton
            size="sm"
            variant="ghost"
            className="contact-history-toggle"
            aria-label="最近导入记录"
            title="最近导入记录"
            icon={<History size={14} />}
            onClick={() => setHistoryOpen((current) => !current)}
          />
        </div>
      }
      dataSection="contacts"
    >
      {preview && (
        <section className="contact-import-preview" data-import-preview>
          <header>
            <span>
              <strong>导入预览：{preview.file_name}</strong>
              <em>
                共 {preview.total_count} 条 · 新增 {preview.new_count} · 可合并 {preview.merge_count} ·
                重复/无效 {preview.duplicate_count + preview.invalid_count}
              </em>
            </span>
          </header>
          <div className="contact-import-selection-toolbar">
            <span>批量选择：</span>
            <SettingsButton size="sm" onClick={() => setAllSelection('create')}>全部新增</SettingsButton>
            <SettingsButton size="sm" onClick={() => setAllSelection('merge')}>全部合并</SettingsButton>
            <SettingsButton size="sm" onClick={() => setAllSelection('skip')}>全部跳过</SettingsButton>
          </div>
          <div className="contact-import-preview-list">
            {preview.entries.map((entry) => (
              <div className="contact-import-preview-row" key={`${entry.email}-${entry.status}`}>
                <span className={`contact-import-status ${entry.status}`}>{entry.status === 'new' ? '新增' : entry.status === 'merge' ? '合并' : entry.status === 'duplicate' ? '重复' : '无效'}</span>
                <span className="contact-import-identity">
                  <strong>{entry.name || entry.email}</strong>
                  <em>{entry.email}{entry.aliases.length ? `（别名 ${entry.aliases.length}）` : ''}</em>
                </span>
                <small>{entry.existing_name ? `已有：${entry.existing_name}` : entry.reason}</small>
                <select
                  value={selectionMap[`${entry.email}|${entry.status}`] ?? (entry.status === 'invalid' ? 'skip' : 'create')}
                  onChange={(event) => setSelection(`${entry.email}|${entry.status}`, event.target.value as 'create' | 'merge' | 'skip')}
                  disabled={entry.status === 'invalid'}
                >
                  <option value="create">新增</option>
                  <option value="merge" disabled={entry.status === 'new'}>合并到已有</option>
                  <option value="skip">跳过</option>
                </select>
              </div>
            ))}
          </div>
          <div className="contact-import-preview-actions">
            <SettingsButton icon={<X size={14} />} onClick={cancelImport} disabled={importing}>
              取消
            </SettingsButton>
            <SettingsButton variant="primary" icon={importing ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />} onClick={handleCommitImport} disabled={importing}>
              确认导入（{preview.entries.filter((entry) => (selectionMap[`${entry.email}|${entry.status}`] ?? (entry.status === 'invalid' ? 'skip' : 'create')) !== 'skip' && entry.status !== 'invalid').length} 条）
            </SettingsButton>
          </div>
        </section>
      )}

      {historyOpen && (
        <section className="contact-import-history" data-import-history>
          <header>
            <span>
              <strong>最近导入记录</strong>
              <em>{batches.length} 批次</em>
            </span>
          </header>
          {batches.length === 0 && <p className="settings-empty-hint">暂无导入记录。</p>}
          {batches.map((batch) => (
            <div className="contact-import-history-row" key={batch.id}>
              <span>
                <strong>{batch.file_name}</strong>
                <em>
                  {new Date(batch.created_at).toLocaleString()} · 新增 {batch.created_count} ·
                  合并 {batch.merged_count} · 跳过 {batch.skipped_count}
                </em>
              </span>
              <SettingsButton
                size="sm"
                disabled={batch.created_count === 0 || undoingBatchId === batch.id}
                icon={<Undo2 size={13} />}
                onClick={() => setConfirmUndoBatch(batch)}
              >
                {batch.created_count > 0 ? '撤销本批新增' : '无可撤销'}
              </SettingsButton>
            </div>
          ))}
        </section>
      )}

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
        <SettingsField label="别名邮箱">
          <textarea
            value={contactFormAliases}
            onChange={(event) => onContactFormAliasesChange(event.target.value)}
            placeholder="别名邮箱，逗号或换行分隔"
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
        <SettingsEmptyState>还没有联系人。可以手动新增，或从 vCard 文件导入。</SettingsEmptyState>
      ) : (
        <div className="settings-contact-list">
          {contacts.slice(0, 6).map((contact) => (
            <div className="st-data-row contact-tool-row" key={contact.id}>
              {editingContactId === contact.id ? (
                <div className="contact-edit-form">
                  <input
                    value={editName}
                    onChange={(event) => onEditNameChange(event.target.value)}
                    placeholder="联系人名称"
                  />
                  <textarea
                    value={editAliases}
                    onChange={(event) => onEditAliasesChange(event.target.value)}
                    placeholder="别名邮箱，逗号或换行分隔"
                  />
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
                      <em>{contact.email}{contact.aliases.length ? ` · 别名 ${contact.aliases.length}` : ''}</em>
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
        </div>
      )}

      <SettingsField label="合并来源">
        <select
          value={mergeSourceContactId ?? ''}
          onChange={(event) => onMergeSourceChange(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">选择一个联系人</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.name || contact.email} · {contact.email}
            </option>
          ))}
        </select>
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
    </SettingsSection>
  );
}
