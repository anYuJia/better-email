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
  ContactMergeSuggestion,
} from '../../app/types';
import useContactImportManager from '../../hooks/useContactImportManager';
import './automation-settings.css';

type ContactAutomationSettingsProps = {
  mergeSuggestions: ContactMergeSuggestion[];
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
  onMergeSuggested: (suggestion: ContactMergeSuggestion) => void;
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
  mergeSuggestions,
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
  onMergeSuggested,
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
    <section className="tool-panel settings-contact-panel" data-settings-section="contacts">
      <header className="tool-header">
        <span>
          <strong>联系人管理</strong>
          <small>别名、VIP、重复合并和快捷写信</small>
        </span>
        <div className="contact-transfer-actions">
          <em>{contacts.length} 位联系人</em>
          <button type="button" onClick={startImport} disabled={transferBusy || previewing}>
            {previewing ? <LoaderCircle className="spinning" size={14} /> : <FileDown size={14} />}
            导入联系人
          </button>
          <button type="button" onClick={onExportContacts} disabled={transferBusy || contacts.length === 0}>
            <FileUp size={14} />
            导出 vCard
          </button>
          <button
            type="button"
            className="contact-history-toggle"
            title="最近导入记录"
            onClick={() => setHistoryOpen((current) => !current)}
          >
            <History size={14} />
          </button>
        </div>
      </header>

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
            <button type="button" onClick={() => setAllSelection('create')}>全部新增</button>
            <button type="button" onClick={() => setAllSelection('merge')}>全部合并</button>
            <button type="button" onClick={() => setAllSelection('skip')}>全部跳过</button>
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
            <button type="button" onClick={cancelImport} disabled={importing}>
              <X size={14} /> 取消
            </button>
            <button type="button" className="primary" onClick={handleCommitImport} disabled={importing}>
              {importing ? <LoaderCircle className="spinning" size={14} /> : <Check size={14} />}
              确认导入（{preview.entries.filter((entry) => (selectionMap[`${entry.email}|${entry.status}`] ?? (entry.status === 'invalid' ? 'skip' : 'create')) !== 'skip' && entry.status !== 'invalid').length} 条）
            </button>
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
              <button
                type="button"
                className="secondary"
                disabled={batch.created_count === 0 || undoingBatchId === batch.id}
                onClick={() => setConfirmUndoBatch(batch)}
              >
                <Undo2 size={13} />
                {batch.created_count > 0 ? '撤销本批新增' : '无可撤销'}
              </button>
            </div>
          ))}
        </section>
      )}

      {mergeSuggestions.length > 0 && (
        <section className="contact-suggestion-panel">
          <header>
            <span>
              <strong>重复联系人建议</strong>
              <em>{mergeSuggestions.length} 组待处理</em>
            </span>
          </header>
          {mergeSuggestions.slice(0, 3).map((suggestion) => (
            <div className="contact-suggestion" key={`${suggestion.target.id}-${suggestion.source.id}`}>
              <span>
                <strong>{suggestion.source.name || suggestion.source.email}</strong>
                <em>合并到 {suggestion.target.name || suggestion.target.email}</em>
                <small>{suggestion.reason} · {suggestion.shared_keys.join(', ')}</small>
              </span>
              <button type="button" onClick={() => onMergeSuggested(suggestion)}>
                <Merge size={14} />
                合并建议
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="contact-create-form settings-contact-create">
        <input
          value={contactForm.name}
          onChange={(event) => onContactFormChange({ ...contactForm, name: event.target.value })}
          placeholder="联系人名称"
        />
        <input
          value={contactForm.email}
          onChange={(event) => onContactFormChange({ ...contactForm, email: event.target.value })}
          placeholder="邮箱地址"
        />
        <textarea
          value={contactFormAliases}
          onChange={(event) => onContactFormAliasesChange(event.target.value)}
          placeholder="别名邮箱，逗号或换行分隔"
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={contactForm.vip}
            onChange={(event) => onContactFormChange({ ...contactForm, vip: event.target.checked })}
          />
          <span>
            <strong>设为 VIP</strong>
            <small>可配合通知策略只提醒重要联系人</small>
          </span>
        </label>
        <button type="button" onClick={onCreateContact}>
          <UserPlus size={14} />
          新增联系人
        </button>
      </div>

      <div className="settings-contact-list">
        {contacts.slice(0, 6).map((contact) => (
          <div className="tool-row contact-tool-row" key={contact.id}>
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
                <div>
                  <button type="button" onClick={() => onSaveContactOverride(contact)}>保存</button>
                  <button type="button" className="secondary" onClick={onCancelEdit}>取消</button>
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
                  <button
                    type="button"
                    aria-label={`编辑 ${contact.name || contact.email}`}
                    title="编辑联系人"
                    onClick={() => onStartEditContact(contact)}
                  >
                    <Pencil size={13} />
                    <span className="contact-action-label">编辑</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`${contact.vip ? '取消 VIP' : '设为 VIP'} ${contact.name || contact.email}`}
                    title={contact.vip ? '取消 VIP' : '设为 VIP'}
                    onClick={() => onToggleContactVip(contact)}
                  >
                    <Star size={13} />
                    <span className="contact-action-label">{contact.vip ? '取消 VIP' : '设为 VIP'}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`合并 ${contact.name || contact.email}`}
                    title="合并联系人"
                    onClick={() => onMergeContact(contact)}
                  >
                    <Merge size={13} />
                    <span className="contact-action-label">合并</span>
                  </button>
                  <button
                    type="button"
                    className="danger"
                    aria-label={`删除 ${contact.name || contact.email}`}
                    title="删除联系人"
                    onClick={() => onDeleteContact(contact)}
                  >
                    <Trash2 size={13} />
                    <span className="contact-action-label">删除</span>
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <label className="contact-merge-picker">
        合并来源
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
      </label>

      {confirmUndoBatch && (
        <div className="settings-cache-confirm-backdrop">
          <div className="settings-cache-confirm" role="dialog" aria-modal="true">
            <strong>撤销导入批次</strong>
            <p>
              将删除「{confirmUndoBatch.file_name}」批次新增的 {confirmUndoBatch.created_count} 位联系人。
              合并/更新已有联系人的变更不可回滚。
            </p>
            <div>
              <button type="button" onClick={() => setConfirmUndoBatch(null)}>取消</button>
              <button
                type="button"
                className="danger-action"
                disabled={undoingBatchId === confirmUndoBatch.id}
                onClick={() => { void undoBatch(confirmUndoBatch.id); void onRefreshContacts(); }}
              >
                {undoingBatchId === confirmUndoBatch.id ? '撤销中…' : '确认撤销'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
