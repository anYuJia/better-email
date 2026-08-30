import { describe, expect, it } from 'vitest';
import {
  decodeImapModifiedUtf7,
  imapMailboxDisplayName,
} from './imapMailboxDisplay';

describe('IMAP mailbox display names', () => {
  it('decodes Modified UTF-7 without changing the raw server value', () => {
    const rawName = 'Projects/&ZeVnLIqe-';
    expect(decodeImapModifiedUtf7(rawName)).toBe('Projects/日本語');
    expect(rawName).toBe('Projects/&ZeVnLIqe-');
  });

  it('decodes the literal ampersand escape and preserves invalid sequences', () => {
    expect(decodeImapModifiedUtf7('Research &- Notes')).toBe('Research & Notes');
    expect(decodeImapModifiedUtf7('Broken &***-')).toBe('Broken &***-');
  });

  it('localizes known system roles and decodes custom mailbox names', () => {
    expect(imapMailboxDisplayName({ local_role: 'inbox', remote_name: 'INBOX' })).toBe('收件箱');
    expect(imapMailboxDisplayName({ local_role: 'sent', remote_name: 'Sent Messages' })).toBe('已发送');
    expect(imapMailboxDisplayName({ local_role: 'custom', remote_name: '&ZeVnLIqe-' })).toBe('日本語');
  });
});
