import { describe, expect, it } from 'vitest';
import type { Contact } from '../../app/types';
import {
  buildContactSearchEntries,
  datalistContacts,
  matchingContacts,
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
    expect(datalistContacts(entries, '', contacts, 0)).toEqual([]);
    expect(datalistContacts(entries, 'example', contacts, -1)).toEqual([]);
  });

  it('limits the idle datalist but keeps queried suggestions focused', () => {
    const contacts = Array.from({ length: 40 }, (_, index) =>
      contact(index + 1, `Contact ${index + 1}`, `contact${index + 1}@example.com`),
    );
    const entries = buildContactSearchEntries(contacts);
    const suggestions = matchingContacts(entries, 'contact39', 5);

    expect(datalistContacts(entries, '', suggestions, 30)).toHaveLength(30);
    expect(datalistContacts(entries, 'contact39', suggestions, 30)).toEqual([contacts[38]]);
  });
});
