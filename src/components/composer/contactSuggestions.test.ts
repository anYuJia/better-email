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
    account_id: 1,
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

  it('matches Chinese names by initials, partial/full pinyin and same-pinyin Chinese input', () => {
    const hanhan = contact(1, '涵涵', 'hanhan@example.com');
    const entries = buildContactSearchEntries([hanhan]);

    expect(matchingContacts(entries, '涵涵', 5)).toEqual([hanhan]);
    expect(matchingContacts(entries, 'hh', 5)).toEqual([hanhan]);
    expect(matchingContacts(entries, 'hanh', 5)).toEqual([hanhan]);
    expect(matchingContacts(entries, 'hanhan', 5)).toEqual([hanhan]);
    expect(matchingContacts(entries, '韩韩', 5)).toEqual([hanhan]);
  });

  it('does not return matches for an empty query', () => {
    const contacts = [contact(1, 'Ada Lovelace', 'ada@example.com')];
    const entries = buildContactSearchEntries(contacts);
    expect(matchingContacts(entries, '', 5)).toEqual([]);
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

  it('keeps recommendations available for explicit contact surfaces', () => {
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

  it('ranks VIP, frequent and recent contacts before the original order', () => {
    const frequent = {
      ...contact(1, 'Frequent', 'frequent@example.com'),
      message_count: 20,
      last_seen_at: '2026-08-20T08:00:00Z',
    };
    const recent = {
      ...contact(2, 'Recent', 'recent@example.com'),
      message_count: 20,
      last_seen_at: '2026-08-26T08:00:00Z',
    };
    const vip = {
      ...contact(3, 'VIP', 'vip@example.com'),
      vip: true,
      message_count: 1,
      last_seen_at: '2026-01-01T08:00:00Z',
    };

    const entries = buildContactSearchEntries([frequent, recent, vip]);
    expect(entries.map((entry) => entry.contact.email)).toEqual([
      'vip@example.com',
      'recent@example.com',
      'frequent@example.com',
    ]);
  });
});
