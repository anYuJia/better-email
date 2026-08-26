import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Search,
  Settings2,
  UserRound,
  X,
} from 'lucide-react';
import type { Contact, DraftInput } from '../../app/types';
import { parseRecipientInput } from './recipientAddresses';

export type ComposerRecipientField = 'to' | 'cc' | 'bcc';

export type AddContactsResult = {
  addedIds: number[];
  skippedIds: number[];
};

type ComposerContactsPanelProps = {
  contacts: Contact[];
  draft: DraftInput;
  activeRecipientField: ComposerRecipientField;
  onRecipientFieldChange: (field: ComposerRecipientField) => void;
  onAddContacts: (contacts: Contact[], field: ComposerRecipientField) => AddContactsResult;
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
  onRecipientFieldChange,
  onAddContacts,
  onClose,
  onOpenContactsSettings,
}: ComposerContactsPanelProps) {
  const [view, setView] = useState<ContactView>('recent');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const targetRootRef = useRef<HTMLDivElement | null>(null);
  const targetMenuRef = useRef<HTMLDivElement | null>(null);
  const targetToggleRef = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(
        [...current].filter((id) => {
          const contact = contacts.find((entry) => entry.id === id);
          return Boolean(contact && !addedField(contact, draft));
        }),
      );
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [contacts, draft]);

  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedIds.has(contact.id) && !addedField(contact, draft)),
    [contacts, draft, selectedIds],
  );

  useEffect(() => {
    if (!targetMenuOpen) return undefined;
    targetMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    function closeOnPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && targetRootRef.current?.contains(event.target)) return;
      setTargetMenuOpen(false);
      targetToggleRef.current?.focus({ preventScroll: true });
    }
    function closeOnKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setTargetMenuOpen(false);
        targetToggleRef.current?.focus({ preventScroll: true });
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = Array.from(targetMenuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Home' || event.key === 'End') {
        (event.key === 'Home' ? items[0] : items[items.length - 1]).focus({ preventScroll: true });
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(currentIndex + delta + items.length) % items.length].focus({ preventScroll: true });
    }
    document.addEventListener('pointerdown', closeOnPointerDown, true);
    document.addEventListener('keydown', closeOnKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown, true);
      document.removeEventListener('keydown', closeOnKeyDown, true);
    };
  }, [targetMenuOpen]);

  function closeTargetMenu() {
    setTargetMenuOpen(false);
    queueMicrotask(() => targetToggleRef.current?.focus({ preventScroll: true }));
  }

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
    const result = onAddContacts(selectedContacts, activeRecipientField);
    setSelectedIds((current) => new Set([...current].filter((id) => !result.addedIds.includes(id))));
    closeTargetMenu();
  }

  const targetLabel = RECIPIENT_FIELDS.find((field) => field.value === activeRecipientField)?.label ?? '收件人';
  const emptyTitle = query ? '没有找到匹配联系人' : '还没有联系人';
  const emptyDescription = query ? '试试搜索其他姓名或邮箱' : '可以先到联系人设置中添加';

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
          const selected = selectedIds.has(contact.id) && !addedTo;
          const avatarLabel = contactAvatarLabel(contact);
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
                {avatarLabel ?? <UserRound size={17} />}
              </span>
              <span className={`composer-contact-copy${hasName ? '' : ' is-email-only'}`}>
                <strong title={name}>{name}</strong>
                {hasName && <small title={contact.email}>{contact.email}</small>}
              </span>
              {addedTo ? (
                <span className="composer-contact-add is-added" aria-label={`${name}已添加到${addedTo === 'to' ? '收件人' : addedTo === 'cc' ? '抄送' : '密送'}`}>
                  <Check size={13} aria-hidden="true" />已添加
                </span>
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
        <div className="composer-contact-batch" ref={targetRootRef}>
          <button type="button" disabled={selectedContacts.length === 0} onClick={addSelected}>
            添加到{targetLabel}
          </button>
          <button
            type="button"
            ref={targetToggleRef}
            aria-label="选择添加目标"
            aria-expanded={targetMenuOpen}
            onClick={() => setTargetMenuOpen((current) => !current)}
          >
            <span aria-hidden="true">⌄</span>
          </button>
          {targetMenuOpen && (
            <div ref={targetMenuRef} className="composer-contact-target-menu" role="menu" aria-label="添加到">
              {RECIPIENT_FIELDS.map((field) => (
                <button
                  key={field.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeRecipientField === field.value}
                  onClick={() => {
                    onRecipientFieldChange(field.value);
                    closeTargetMenu();
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
