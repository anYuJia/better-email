import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Search,
  Settings2,
  UserRound,
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

type ContactView = 'recent' | 'frequent' | 'groups';

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

function contactSecondary(contact: Contact, name: string) {
  const email = contact.email.trim();
  return name.toLowerCase() === email.toLowerCase() ? '邮箱地址' : email;
}

function contactSearchText(contact: Contact) {
  return [contact.name, contact.email, ...(contact.aliases ?? [])].join(' ').toLowerCase();
}

function dateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function contactInitial(contact: Contact) {
  const name = contact.name.trim();
  if (!name) return contact.email.trim().slice(0, 1).toUpperCase() || '?';
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

function addedField(contact: Contact, draft: DraftInput) {
  const addresses = [contact.email, ...(contact.aliases ?? [])]
    .map(normalized)
    .filter(Boolean);
  const fields: Array<[ComposerRecipientField, string]> = [
    ['to', draft.to],
    ['cc', draft.cc],
    ['bcc', draft.bcc],
  ];
  return fields.find(([, value]) => recipientTokens(value).some((item) => addresses.includes(item)))?.[0] ?? null;
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
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);

  const visibleContacts = useMemo(() => {
    if (view === 'groups') return [];
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

  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedIds.has(contact.id) && !addedField(contact, draft)),
    [contacts, draft, selectedIds],
  );

  function toggleSelected(contact: Contact) {
    if (addedField(contact, draft)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(contact.id)) next.delete(contact.id);
      else next.add(contact.id);
      return next;
    });
  }

  function addSelected() {
    if (selectedContacts.length === 0) return;
    selectedContacts.forEach((contact) => onAddContact(contact, recipientField));
    setSelectedIds(new Set());
    setTargetMenuOpen(false);
  }

  const targetLabel = RECIPIENT_FIELDS.find((field) => field.value === recipientField)?.label ?? '收件人';
  const addedLabel = (field: ComposerRecipientField) => field === 'to'
    ? '已添加'
    : `已加入${field === 'cc' ? '抄送' : '密送'}`;
  const emptyTitle = view === 'groups'
    ? '暂无联系人群组'
    : query
      ? '没有找到匹配联系人'
      : '还没有联系人';
  const emptyDescription = view === 'groups'
    ? '当前账号还没有可用的联系人群组'
    : query
      ? '试试搜索其他姓名或邮箱'
      : '可以先到联系人设置中添加';

  return (
    <aside id="composer-contacts-panel" className="composer-contacts-panel" aria-label="联系人">
      <div className="composer-contacts-header">
        <strong>联系人</strong>
        <div className="composer-contacts-heading-actions">
          {onOpenContactsSettings ? (
            <button type="button" aria-label="管理联系人" title="管理联系人" onClick={onOpenContactsSettings}>
              <Settings2 size={16} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="composer-contacts-close"
            aria-label="关闭联系人面板"
            title="关闭联系人面板"
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="composer-contacts-toolbar">
        <label className="composer-contacts-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索联系人"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索姓名、邮箱或拼音"
          />
          {query && (
            <button type="button" aria-label="清除联系人搜索" onClick={() => setQuery('')}>
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </label>

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
          <button
            type="button"
            role="tab"
            aria-selected={view === 'groups'}
            className={view === 'groups' ? 'is-active' : ''}
            onClick={() => setView('groups')}
          >
            群组
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="composer-contacts-list" role="list" aria-label={view === 'recent' ? '最近联系人列表' : view === 'frequent' ? '常用联系人列表' : '联系人群组列表'}>
        {visibleContacts.map((contact) => {
          const name = contactName(contact);
          const addedTo = addedField(contact, draft);
          const selected = selectedIds.has(contact.id) && !addedTo;
          return (
            <article
              className={`composer-contact-row${selected ? ' is-selected' : ''}${addedTo ? ' is-added' : ''}`}
              key={contact.id}
              data-contact-id={contact.id}
              role="listitem"
              tabIndex={addedTo ? -1 : 0}
              onClick={() => toggleSelected(contact)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleSelected(contact);
                }
              }}
            >
              <button
                type="button"
                className={`composer-contact-select${selected ? ' is-selected' : ''}`}
                aria-label={addedTo ? `${name}已添加到${addedTo === 'to' ? '收件人' : addedTo === 'cc' ? '抄送' : '密送'}` : selected ? `取消选择 ${name}` : `选择 ${name}`}
                aria-pressed={selected}
                disabled={Boolean(addedTo)}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleSelected(contact);
                }}
              >
                {selected || addedTo ? <Check size={15} aria-hidden="true" /> : null}
              </button>
              <span className={`composer-contact-avatar tone-${avatarTone(contact)}`} aria-hidden="true">
                {contactInitial(contact)}
              </span>
              <span className="composer-contact-copy">
                <strong title={name}>{name}</strong>
                <small title={contactSecondary(contact, name)}>{contactSecondary(contact, name)}</small>
              </span>
              {addedTo ? (
                <button
                  type="button"
                  className="composer-contact-add"
                  disabled
                  aria-label={`${name}${addedLabel(addedTo)}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Check size={13} aria-hidden="true" />{addedLabel(addedTo)}
                </button>
              ) : <span className="composer-contact-status-spacer" aria-hidden="true" />}
            </article>
          );
        })}
        {visibleContacts.length === 0 && (
          <div className="composer-contacts-empty">
            <span className="composer-contacts-empty-icon" aria-hidden="true">
              <UserRound size={19} />
            </span>
            <strong>{emptyTitle}</strong>
            <small>{emptyDescription}</small>
          </div>
        )}
      </div>

      <div className="composer-contacts-footer">
        <span>
          已选择 <strong>{selectedContacts.length}</strong> 位联系人
        </span>
        <div className="composer-contact-batch">
          <button type="button" disabled={selectedContacts.length === 0} onClick={addSelected}>
            添加到{targetLabel}
          </button>
          <button
            type="button"
            aria-label="选择添加目标"
            aria-expanded={targetMenuOpen}
            disabled={selectedContacts.length === 0}
            onClick={() => setTargetMenuOpen((current) => !current)}
          >
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {targetMenuOpen && (
            <div className="composer-contact-target-menu" role="menu" aria-label="添加到">
              {RECIPIENT_FIELDS.map((field) => (
                <button
                  key={field.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={recipientField === field.value}
                  onClick={() => {
                    setRecipientField(field.value);
                    setTargetMenuOpen(false);
                  }}
                >
                  {field.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
