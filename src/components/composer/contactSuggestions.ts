import type { Contact } from '../../app/types';

export type ContactSearchEntry = {
  contact: Contact;
  searchText: string;
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
    }));
}

export function matchingContacts(
  entries: ContactSearchEntry[],
  query: string,
  limit: number,
): Contact[] {
  if (limit <= 0) return [];
  const normalizedQuery = query.trim().toLowerCase();
  const matches: Contact[] = [];
  for (const entry of entries) {
    if (!normalizedQuery || entry.searchText.includes(normalizedQuery)) {
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
