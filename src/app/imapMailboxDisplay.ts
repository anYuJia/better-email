import type { ImapMailboxState } from './types';

const systemMailboxLabels: Record<string, string> = {
  inbox: '收件箱',
  sent: '已发送',
  drafts: '草稿箱',
  archive: '归档',
  trash: '废纸篓',
  spam: '垃圾邮件',
};

/**
 * IMAP mailbox names may arrive in Modified UTF-7. Keep the original value
 * for server commands and decode only the user-facing label.
 */
export function decodeImapModifiedUtf7(value: string): string {
  return value.replace(/&([^-]*)-/g, (sequence, encoded: string) => {
    if (encoded === '') return '&';
    if (typeof globalThis.atob !== 'function') return sequence;

    try {
      const base64 = encoded.replace(/,/g, '/');
      const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
      const binary = globalThis.atob(padded);
      if (binary.length === 0 || binary.length % 2 !== 0) return sequence;

      let decoded = '';
      for (let index = 0; index < binary.length; index += 2) {
        decoded += String.fromCharCode(
          (binary.charCodeAt(index) << 8) | binary.charCodeAt(index + 1),
        );
      }
      return decoded;
    } catch {
      return sequence;
    }
  });
}

export function imapMailboxDisplayName(
  mailbox: Pick<ImapMailboxState, 'local_role' | 'remote_name'>,
): string {
  return systemMailboxLabels[mailbox.local_role]
    ?? decodeImapModifiedUtf7(mailbox.remote_name)
    ?? mailbox.remote_name;
}
