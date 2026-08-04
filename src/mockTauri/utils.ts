import type { ListSort } from '../app/types';
import type { MockContact, MockMessage } from './types';

export function normalizeMockSyncMode(syncMode: unknown) {
  const normalized = String(syncMode ?? '').trim();
  if (normalized === 'push') return '5min';
  return ['manual', '1min', '5min', '15min', '30min', '60min'].includes(normalized)
    ? normalized
    : 'manual';
}

export function mimeTypeForMockPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'txt':
    case 'log':
    case 'md':
      return 'text/plain';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'csv':
      return 'text/csv';
    case 'pdf':
      return 'application/pdf';
    case 'json':
      return 'application/json';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'zip':
      return 'application/zip';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    default:
      return 'application/octet-stream';
  }
}

export function normalizeListSort(value: unknown): ListSort {
  return value === 'oldest' || value === 'sender' || value === 'subject'
    ? value
    : 'newest';
}

export function compareMessagesBySort(left: MockMessage, right: MockMessage, sort: ListSort) {
  if (sort === 'oldest') {
    return left.received_at.localeCompare(right.received_at) || left.id - right.id;
  }
  if (sort === 'sender') {
    return left.sender_name.localeCompare(right.sender_name)
      || left.sender_email.localeCompare(right.sender_email)
      || right.received_at.localeCompare(left.received_at)
      || right.id - left.id;
  }
  if (sort === 'subject') {
    return left.subject.localeCompare(right.subject)
      || right.received_at.localeCompare(left.received_at)
      || right.id - left.id;
  }
  return right.received_at.localeCompare(left.received_at) || right.id - left.id;
}

export function normalizedThreadSubject(subject: string) {
  let normalized = subject.trim() || '(无主题)';
  while (/^(re|fwd|fw|回复|转发)\s*[:：]\s*/i.test(normalized)) {
    normalized = normalized.replace(/^(re|fwd|fw|回复|转发)\s*[:：]\s*/i, '').trim() || '(无主题)';
  }
  return normalized;
}

export function firstMessageId(value: string | undefined) {
  return (value ?? '')
    .split(/\s+/)
    .map((token) => token.replace(/^[,;]+|[,;]+$/g, ''))
    .find((token) => /^<[^<>\s]+>$/.test(token))
    ?.toLowerCase();
}

export function messageThreadKey(message: MockMessage) {
  const messageId =
    firstMessageId(message.references_header)
    ?? firstMessageId(message.in_reply_to_header)
    ?? firstMessageId(message.message_id_header);
  return messageId
    ? `msgid:${messageId}`
    : `subject:${normalizedThreadSubject(message.subject).toLowerCase()}`;
}

export function mutedThreadScopeKey(accountId: number, threadKey: string) {
  return `${accountId}:${threadKey}`;
}

export function contactIdentityKeys(contact: MockContact) {
  const keys = [contact.email, ...contact.aliases].map((value) => value.trim().toLowerCase()).filter(Boolean);
  const domain = contact.email.split('@')[1] ?? '';
  const name = contact.name.trim().toLowerCase();
  if (domain && name && name !== contact.email.toLowerCase()) keys.push(`${name}@${domain}`);
  contact.name
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 4)
    .forEach((part) => keys.push(part));
  return [...new Set(keys)];
}
