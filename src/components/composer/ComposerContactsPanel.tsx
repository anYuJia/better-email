import { useMemo, useState } from 'react';
import {
  Check,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  UserRound,
  X,
} from 'lucide-react';
import type { Contact, DraftInput } from '../../app/types';
import { parseRecipientInput } from './recipientAddresses';
import './contact-scan.css';

export type ComposerRecipientField = 'to' | 'cc' | 'bcc';

export type AddContactsResult = {
  addedIds: number[];
  skippedIds: number[];
};

type ComposerContactsPanelProps = {
  contacts: Contact[];
  draft: DraftInput;
  activeRecipientField: ComposerRecipientField;
  onAddContacts: (contacts: Contact[], field: ComposerRecipientField) => AddContactsResult;
  onClose: () => void;
  showClose?: boolean;
  onOpenContactsSettings?: () => void;
  onScanRecentContacts?: () => Promise<void>;
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

function contactDisplayName(contact: Contact) {
  return contact.name.trim() || contact.email.trim();
}

function contactSearchText(contact: Contact) {
  return [contact.name, contact.email, ...(contact.aliases ?? [])].join(' ').toLowerCase();
}

function dateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function contactAvatarLabel(contact: Contact) {
  const name = contact.name.trim();
  if (name && normalized(name) !== normalized(contact.email)) return Array.from(name)[0] ?? null;
  const prefix = contact.email.trim().split('@')[0] ?? '';
  return /^[A-Za-z]/.test(prefix) ? prefix[0].toUpperCase() : null;
}

function avatarTone(contact: Contact) {
  return AVATAR_TONES[Math.abs(contact.id) % AVATAR_TONES.length];
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
  return fields.find(([, value]) => parseRecipientInput(value).valid.some((item) => addresses.includes(item.normalized)))?.[0] ?? null;
}

function compareByRecent(left: Contact, right: Contact) {
  return (
    dateValue(right.last_seen_at) - dateValue(left.last_seen_at)
    || right.message_count - left.message_count
    || contactDisplayName(left).localeCompare(contactDisplayName(right), 'zh-CN')
  );
}

function compareByFrequency(left: Contact, right: Contact) {
  return (
    Number(right.vip) - Number(left.vip)
    || right.message_count - left.message_count
    || dateValue(right.last_seen_at) - dateValue(left.last_seen_at)
    || contactDisplayName(left).localeCompare(contactDisplayName(right), 'zh-CN')
  );
}

export default function ComposerContactsPanel({
  contacts,
  draft,
  activeRecipientField,
  onAddContacts,
  onClose,
  showClose = true,
  onOpenContactsSettings,
  onScanRecentContacts,
}: ComposerContactsPanelProps) {
  const [view, setView] = useState<ContactView>('recent');
  const [query, setQuery] = useState('');
  const [scanBusy, setScanBusy] = useState(false);

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

  function addContact(contact: Contact) {
    if (addedField(contact, draft)) return;
    onAddContacts([contact], activeRecipientField);
  }

  const targetLabel = RECIPIENT_FIELDS.find((field) => field.value === activeRecipientField)?.label ?? '收件人';
  const emptyTitle = query ? '没有找到匹配联系人' : '还没有联系人';
  const emptyDescription = query ? '试试搜索其他姓名或邮箱' : '可以先到联系人设置中添加';

  return (
    <aside id="composer-contacts-panel" className="composer-contacts-panel" aria-label="联系人">
      <div className="composer-contacts-header">
        <div className="composer-contacts-heading">
          <strong>联系人</strong>
        </div>
        {onScanRecentContacts ? (
          <button
            type="button"
            className="composer-contacts-scan"
            title="通过扫描已发送邮件头，获取联系人的姓名(若设置了别名)、邮箱地址等"
            aria-label="扫描同步最近联系人"
            disabled={scanBusy}
            onClick={async () => {
              setScanBusy(true);
              try {
                await onScanRecentContacts();
              } finally {
                setScanBusy(false);
              }
            }}
          >
            <RefreshCw size={13} aria-hidden="true" className={scanBusy ? 'is-spinning' : ''} />
            <span>{scanBusy ? '正在扫描…' : '同步'}</span>
          </button>
        ) : null}
        <div className="composer-contacts-heading-actions">
          {onOpenContactsSettings ? (
            <button type="button" aria-label="管理联系人" title="管理联系人" onClick={onOpenContactsSettings}>
              <Settings2 size={16} aria-hidden="true" />
            </button>
          ) : null}
          {showClose && (
            <button
              type="button"
              className="composer-contacts-close"
              aria-label="关闭联系人面板"
              title="关闭联系人面板"
              onClick={onClose}
            >
              <X size={17} aria-hidden="true" />
            </button>
          )}
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
            placeholder="搜索姓名或邮箱"
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
        </div>
      </div>

      <div className="composer-contacts-list" role="list" aria-label={view === 'recent' ? '最近联系人列表' : '常用联系人列表'}>
        {visibleContacts.map((contact) => {
          const name = contactDisplayName(contact);
          const hasName = Boolean(contact.name.trim() && normalized(contact.name) !== normalized(contact.email));
          const addedTo = addedField(contact, draft);
          const avatarLabel = contactAvatarLabel(contact);
          return (
            <article
              className={`composer-contact-row${addedTo ? ' is-added' : ''}`}
              key={contact.id}
              data-contact-id={contact.id}
              role="listitem"
              tabIndex={addedTo ? -1 : 0}
              aria-label={addedTo ? `${name}已添加到${targetLabel}` : `${name}，按回车添加到${targetLabel}`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  addContact(contact);
                }
              }}
            >
              <span className={`composer-contact-avatar tone-${avatarTone(contact)}`} aria-hidden="true">
                {avatarLabel ?? <UserRound size={17} />}
              </span>
              <span className={`composer-contact-copy${hasName ? '' : ' is-email-only'}`}>
                <strong title={name}>{name}</strong>
                {hasName && <small title={contact.email}>{contact.email}</small>}
              </span>
              {addedTo ? (
                <span className="composer-contact-add is-added">
                  <Check size={13} aria-hidden="true" />已添加
                </span>
              ) : (
                <button
                  type="button"
                  className="composer-contact-add"
                  aria-label={`添加 ${name} 到${targetLabel}`}
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation();
                    addContact(contact);
                  }}
                >
                  <Plus size={13} aria-hidden="true" />添加
                </button>
              )}
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

    </aside>
  );
}
