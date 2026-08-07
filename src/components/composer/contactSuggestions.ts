import type { Contact } from '../../app/types';

export type ContactSearchEntry = {
  contact: Contact;
  searchText: string;
};

function isSuggestedRecipient(contact: Contact) {
  const email = contact.email.trim();
  return email.includes('@') && !/[;,]/.test(email);
}

export function buildContactSearchEntries(contacts: Contact[]): ContactSearchEntry[] {
  return contacts
    .filter(isSuggestedRecipient)
    .map((contact) => ({
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
