import { pinyin } from 'pinyin-pro';
import type { Contact } from '../../app/types';

export type ContactSearchEntry = {
  contact: Contact;
  searchText: string;
  pinyinText?: string;
  pinyinInitials?: string;
};

function isSuggestedRecipient(contact: Contact) {
  const email = contact.email.trim();
  return email.includes('@') && !/[;,]/.test(email);
}

function contactRecency(contact: Contact) {
  const timestamp = Date.parse(contact.last_seen_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareSuggestedContacts(left: Contact, right: Contact) {
  if (left.vip !== right.vip) return left.vip ? -1 : 1;
  if (left.message_count !== right.message_count) return right.message_count - left.message_count;
  const recencyDelta = contactRecency(right) - contactRecency(left);
  if (recencyDelta !== 0) return recencyDelta;
  return 0;
}

function compact(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s'’`·._-]+/g, '');
}

function hasHan(value: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function pinyinFull(value: string) {
  if (!value.trim()) return '';
  return compact(String(pinyin(value, {
    toneType: 'none',
    type: 'string',
    surname: 'head',
  })));
}

function pinyinInitials(value: string) {
  if (!value.trim()) return '';
  return compact(String(pinyin(value, {
    toneType: 'none',
    pattern: 'first',
    type: 'string',
    surname: 'head',
  })));
}

function contactNameText(contact: Contact) {
  return [contact.name, ...contact.aliases].filter(Boolean).join('\n');
}

function contactPinyinText(contact: Contact) {
  const names = contactNameText(contact);
  return names ? pinyinFull(names) : '';
}

function contactPinyinInitials(contact: Contact) {
  const names = contactNameText(contact);
  return names ? pinyinInitials(names) : '';
}

export function buildContactSearchEntries(contacts: Contact[]): ContactSearchEntry[] {
  return contacts
    .filter(isSuggestedRecipient)
    .map((contact, index) => ({ contact, index }))
    .sort((left, right) => compareSuggestedContacts(left.contact, right.contact) || left.index - right.index)
    .map(({ contact }) => ({
      contact,
      searchText: [
        contact.name,
        contact.email,
        ...contact.aliases,
      ].join('\n').toLowerCase(),
      pinyinText: contactPinyinText(contact),
      pinyinInitials: contactPinyinInitials(contact),
    }));
}

export function matchingContacts(
  entries: ContactSearchEntry[],
  query: string,
  limit: number,
): Contact[] {
  if (limit <= 0) return [];
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const compactQuery = compact(normalizedQuery);
  const chineseQueryPinyin = hasHan(normalizedQuery) ? pinyinFull(normalizedQuery) : '';
  const matches: Contact[] = [];

  for (const entry of entries) {
    const directMatch = entry.searchText.includes(normalizedQuery);
    const fullPinyin = entry.pinyinText ?? contactPinyinText(entry.contact);
    const initials = entry.pinyinInitials ?? contactPinyinInitials(entry.contact);
    const pinyinMatch = chineseQueryPinyin
      ? Boolean(chineseQueryPinyin && fullPinyin.includes(chineseQueryPinyin))
      : Boolean(compactQuery && (fullPinyin.includes(compactQuery) || initials.includes(compactQuery)));

    if (directMatch || pinyinMatch) {
      matches.push(entry.contact);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

export function recommendedContacts(entries: ContactSearchEntry[], limit: number): Contact[] {
  if (limit <= 0) return [];
  return entries.slice(0, limit).map((entry) => entry.contact);
}
