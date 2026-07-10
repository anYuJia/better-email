import {
  FileDown,
  FileUp,
  LoaderCircle,
  Merge,
  Pencil,
  Send,
  Star,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type {
  Contact,
  ContactCreateInput,
  ContactMergeSuggestion,
} from '../../app/types';
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
}: ContactAutomationSettingsProps) {
  return (
    <section className="tool-panel settings-contact-panel" data-settings-section="contacts">
      <header className="tool-header">
        <span>
          <strong>联系人管理</strong>
          <small>别名、VIP、重复合并和快捷写信</small>
        </span>
        <div className="contact-transfer-actions">
          <em>{contacts.length} 位联系人</em>
          <button type="button" onClick={onImportContacts} disabled={transferBusy}>
            {transferBusy ? <LoaderCircle className="spinning" size={14} /> : <FileDown size={14} />}
            导入 vCard
          </button>
          <button type="button" onClick={onExportContacts} disabled={transferBusy || contacts.length === 0}>
            <FileUp size={14} />
            导出 vCard
          </button>
        </div>
      </header>

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
                一键合并
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
    </section>
  );
}
