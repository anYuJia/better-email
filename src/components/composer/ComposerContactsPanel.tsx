import { useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Search,
  Settings2,
  Star,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import type { Contact, DraftInput } from '../../app/types';

export type ComposerRecipientField = 'to' | 'cc' | 'bcc';

type ComposerContactsPanelProps = {
  contacts: Contact[];
  draft: DraftInput;
  onAddContact: (contact: Contact, field: ComposerRecipientField) => void;
  onClose: () => void;
  onOpenContactsSettings?: () => void;
};

type ContactView = 'recent' | 'frequent';

const RECIPIENT_FIELDS: Array<{ value: ComposerRecipientField; label: string }> = [
  { value: 'to', label: '收件人' },
  { value: 'cc', label: '抄送' },
  { value: 'bcc', label: '密送' },
];

const AVATAR_TONES = ['blue', 'green', 'orange', 'purple', 'teal', 'rose'] as const;

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function contactName(contact: Contact) {
  return contact.name.trim() || contact.email.trim();
}

function contactSearchText(contact: Contact) {
  return [contact.name, contact.email, ...(contact.aliases ?? [])].join(' ').toLowerCase();
}

function dateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function contactInitials(contact: Contact) {
  const name = contact.name.trim();
  if (!name) return contact.email.trim().slice(0, 1).toUpperCase() || '?';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return Array.from(name)[0] ?? '?';
}

function avatarTone(contact: Contact) {
  return AVATAR_TONES[Math.abs(contact.id) % AVATAR_TONES.length];
}

function recipientTokens(value: string) {
  return value
    .split(/[;,]/)
    .map(normalized)
    .filter(Boolean);
}

function isContactInDraft(contact: Contact, draft: DraftInput) {
  const currentRecipients = new Set([
    ...recipientTokens(draft.to),
    ...recipientTokens(draft.cc),
    ...recipientTokens(draft.bcc),
  ]);
  return [contact.email, ...(contact.aliases ?? [])]
    .map(normalized)
    .filter(Boolean)
    .some((email) => currentRecipients.has(email));
}

function compareByRecent(left: Contact, right: Contact) {
  return (
    dateValue(right.last_seen_at) - dateValue(left.last_seen_at)
    || right.message_count - left.message_count
    || contactName(left).localeCompare(contactName(right), 'zh-CN')
  );
}

function compareByFrequency(left: Contact, right: Contact) {
  return (
    Number(right.vip) - Number(left.vip)
    || right.message_count - left.message_count
    || dateValue(right.last_seen_at) - dateValue(left.last_seen_at)
    || contactName(left).localeCompare(contactName(right), 'zh-CN')
  );
}

export default function ComposerContactsPanel({
  contacts,
  draft,
  onAddContact,
  onClose,
  onOpenContactsSettings,
}: ComposerContactsPanelProps) {
  const [view, setView] = useState<ContactView>('recent');
  const [query, setQuery] = useState('');
  const [recipientField, setRecipientField] = useState<ComposerRecipientField>('to');

  const visibleContacts = useMemo(() => {
    const candidates = view === 'frequent'
      ? contacts.filter((contact) => contact.vip || contact.message_count > 0)
      : contacts;
    const sorted = candidates
      .filter((contact) => normalized(contact.email).includes('@'))
      .sort(view === 'recent' ? compareByRecent : compareByFrequency);
    const search = query.trim().toLowerCase();
    return search
      ? sorted.filter((contact) => contactSearchText(contact).includes(search))
      : sorted;
  }, [contacts, query, view]);

  const frequentCount = useMemo(
    () => contacts.filter((contact) => contact.vip || contact.message_count > 0).length,
    [contacts],
  );

  return (
    <aside className="composer-contacts-panel" aria-label="联系人">
      <div className="composer-contacts-header">
        <div className="composer-contacts-heading">
          <span className="composer-contacts-heading-icon" aria-hidden="true">
            <UsersRound size={16} />
          </span>
          <span>
            <strong>联系人</strong>
            <small>{contacts.length > 0 ? `${contacts.length} 位联系人` : '还没有联系人'}</small>
          </span>
        </div>
        <button
          type="button"
          className="composer-contacts-close"
          aria-label="关闭联系人面板"
          title="关闭联系人面板"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      <div className="composer-contacts-toolbar">
        <div className="composer-contacts-tabs" role="tablist" aria-label="联系人分类">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'recent'}
            className={view === 'recent' ? 'is-active' : ''}
            onClick={() => setView('recent')}
          >
            最近联系人
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'frequent'}
            className={view === 'frequent' ? 'is-active' : ''}
            onClick={() => setView('frequent')}
          >
            常用联系人
            {frequentCount > 0 && <span>{frequentCount}</span>}
          </button>
        </div>

        <label className="composer-contacts-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索联系人"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索姓名或邮箱"
          />
          {query && (
            <button
              type="button"
              aria-label="清除联系人搜索"
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          )}
        </label>

        <div className="composer-contacts-target">
          <span>添加到</span>
          <div role="group" aria-label="添加到收件人、抄送或密送">
            {RECIPIENT_FIELDS.map((field) => (
              <button
                key={field.value}
                type="button"
                aria-pressed={recipientField === field.value}
                className={recipientField === field.value ? 'is-active' : ''}
                onClick={() => setRecipientField(field.value)}
              >
                {field.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="composer-contacts-list" role="list" aria-label={view === 'recent' ? '最近联系人列表' : '常用联系人列表'}>
        {visibleContacts.map((contact) => {
          const name = contactName(contact);
          const alreadyAdded = isContactInDraft(contact, draft);
          return (
            <article
              className={`composer-contact-row${alreadyAdded ? ' is-added' : ''}`}
              key={contact.id}
              data-contact-id={contact.id}
              role="listitem"
            >
              <span className={`composer-contact-avatar tone-${avatarTone(contact)}`} aria-hidden="true">
                {contactInitials(contact)}
              </span>
              <span className="composer-contact-copy">
                <strong title={name}>{name}</strong>
                <small title={contact.email}>{contact.email}</small>
                {contact.vip && (
                  <span className="composer-contact-favorite">
                    <Star size={10} fill="currentColor" aria-hidden="true" />
                    常用
                  </span>
                )}
              </span>
              <button
                type="button"
                className="composer-contact-add"
                disabled={alreadyAdded}
                aria-label={alreadyAdded ? `${name}已添加` : `添加 ${name}`}
                onClick={() => onAddContact(contact, recipientField)}
              >
                {alreadyAdded ? <><Check size={12} />已添加</> : '添加'}
              </button>
            </article>
          );
        })}
        {visibleContacts.length === 0 && (
          <div className="composer-contacts-empty">
            <span className="composer-contacts-empty-icon" aria-hidden="true">
              <UserRound size={18} />
            </span>
            <strong>{query ? '没有找到匹配联系人' : '还没有联系人'}</strong>
            <small>{query ? '试试搜索其他姓名或邮箱' : '可以先到联系人设置中添加'}</small>
          </div>
        )}
      </div>

      <div className="composer-contacts-footer">
        <button
          type="button"
          onClick={onOpenContactsSettings}
          disabled={!onOpenContactsSettings}
        >
          <Settings2 size={14} aria-hidden="true" />
          管理联系人
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
