import type { Contact } from '../../app/types';

export type ContactSearchEntry = {
  contact: Contact;
  searchText: string;
};

export function buildContactSearchEntries(contacts: Contact[]): ContactSearchEntry[] {
  return contacts.map((contact) => ({
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

export function datalistContacts(
  entries: ContactSearchEntry[],
  query: string,
  suggestions: Contact[],
  limit: number,
): Contact[] {
  if (limit <= 0) return [];
  return query.trim()
    ? suggestions
    : entries.slice(0, limit).map((entry) => entry.contact);
}
