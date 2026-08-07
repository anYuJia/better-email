import { describe, expect, it } from 'vitest';
import type { Contact } from '../../app/types';
import {
  buildContactSearchEntries,
  matchingContacts,
  recommendedContacts,
} from './contactSuggestions';

function contact(id: number, name: string, email: string, aliases: string[] = []): Contact {
  return {
    id,
    name,
    email,
    aliases,
    vip: false,
    message_count: 0,
    last_seen_at: '',
  };
}

describe('composer contact suggestions', () => {
  it('matches names emails and aliases case-insensitively', () => {
    const contacts = [
      contact(1, 'Ada Lovelace', 'ada@example.com'),
      contact(2, 'Grace Hopper', 'grace@example.com', ['AmazingGrace@example.com']),
    ];
    const entries = buildContactSearchEntries(contacts);

    expect(matchingContacts(entries, 'LOVELACE', 5)).toEqual([contacts[0]]);
    expect(matchingContacts(entries, 'amazinggrace', 5)).toEqual([contacts[1]]);
  });

  it('stops collecting matches once the visible suggestion limit is reached', () => {
    const contacts = Array.from({ length: 10 }, (_, index) =>
      contact(index + 1, `Contact ${index + 1}`, `contact${index + 1}@example.com`),
    );
    const entries = buildContactSearchEntries(contacts);

    expect(matchingContacts(entries, 'contact', 3)).toEqual(contacts.slice(0, 3));
  });

  it('returns no suggestions when the visible limit is not positive', () => {
    const contacts = [
      contact(1, 'Ada Lovelace', 'ada@example.com'),
      contact(2, 'Grace Hopper', 'grace@example.com'),
    ];
    const entries = buildContactSearchEntries(contacts);

    expect(matchingContacts(entries, 'example', 0)).toEqual([]);
    expect(matchingContacts(entries, 'example', -1)).toEqual([]);
  });

  it('uses recent valid contacts as the fallback recommendations', () => {
    const contacts = [
      contact(1, 'Ada Lovelace', 'ada@example.com'),
      contact(2, 'Invalid combined recipient', 'ada@example.com, grace@example.com'),
      contact(3, 'Grace Hopper', 'grace@example.com'),
    ];
    const entries = buildContactSearchEntries(contacts);

    expect(entries.map((entry) => entry.contact)).toEqual([contacts[0], contacts[2]]);
    expect(recommendedContacts(entries, 5)).toEqual([contacts[0], contacts[2]]);
    expect(recommendedContacts(entries, 1)).toEqual([contacts[0]]);
  });
});
