import { describe, expect, it } from 'vitest';
import {
  buildProviderWriteValidationStatus,
  buildProviderWriteValidationDraft,
  createProviderWriteValidationId,
  matchesProviderWriteValidation,
} from './providerWriteValidation';
import type { Account, Message, OutboxItem } from './types';

const account: Account = {
  id: 7,
  email: 'reader@example.com',
  display_name: 'Reader',
  provider: 'custom',
  imap_host: 'imap.example.com:993',
  smtp_host: 'smtp.example.com:465',
  auth_type: 'password',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: '',
  is_default: true,
};

function validationMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 10,
    account_id: account.id,
    account_email: account.email,
    folder_id: 2,
    folder_role: 'sent',
    sender_name: account.display_name,
    sender_email: account.email,
    recipients: account.email,
    cc: '',
    bcc: '',
    subject: '[Better Email 验收] validation-001',
    snippet: 'validation',
    body: 'validation',
    sanitized_html: '',
    security_warnings: [],
    received_at: '2026-07-10T13:14:15.000Z',
    is_read: true,
    is_starred: false,
    has_attachments: true,
    snoozed_until: '',
    labels: [],
    attachment_count: 1,
    remote_mailbox: 'Sent',
    remote_uid: 41,
    message_id_header: '<validation-001@example.com>',
    in_reply_to_header: '',
    references_header: '',
    ...overrides,
  };
}

describe('provider write validation draft', () => {
  it('creates a stable timestamp identifier', () => {
    expect(createProviderWriteValidationId(new Date('2026-07-10T13:14:15.000Z')))
      .toBe('20260710131415');
  });

  it('prepares a self-addressed draft without automatic delivery or attachments', () => {
    const draft = buildProviderWriteValidationDraft(account, 'validation-001');

    expect(draft.account_id).toBe(account.id);
    expect(draft.to).toBe(account.email);
    expect(draft.subject).toBe('[Better Email 验收] validation-001');
    expect(draft.body).toContain('此草稿不会自动发送');
    expect(draft.body).toContain('不要在主题、正文或附件中粘贴密码、授权码或 Token');
    expect(draft.send_at).toBe('');
    expect(draft.attachments).toEqual([]);
  });

  it('matches a validation id without requiring an unchanged subject prefix', () => {
    expect(matchesProviderWriteValidation('Re: custom validation-001 result', 'validation-001'))
      .toBe(true);
    expect(matchesProviderWriteValidation('another message', 'validation-001')).toBe(false);
  });

  it('tracks smtp, sent archive, self receipt, attachments and remote readiness', () => {
    const baseMessage = validationMessage();
    const receivedMessage = validationMessage({
      id: 11,
      folder_id: 1,
      folder_role: 'inbox',
      received_at: '2026-07-10T13:15:15.000Z',
      is_read: false,
      is_starred: true,
      remote_mailbox: 'INBOX',
      remote_uid: 42,
    });
    const outboxItem: OutboxItem = {
      id: 4,
      message_id: baseMessage.id,
      recipients: account.email,
      subject: baseMessage.subject,
      status: 'sent',
      attempts: 1,
      last_error: '',
      queued_at: baseMessage.received_at,
      next_attempt_at: '',
    };
    const status = buildProviderWriteValidationStatus(
      'validation-001',
      [baseMessage, receivedMessage],
      [outboxItem],
    );

    expect(status?.complete).toBe(true);
    expect(status?.passedCoreStages).toBe(3);
    expect(status?.sentMessageId).toBe(baseMessage.id);
    expect(status?.receivedMessageId).toBe(receivedMessage.id);
    expect(status?.stages.find((stage) => stage.id === 'attachment')?.tone).toBe('passed');
    expect(status?.stages.find((stage) => stage.id === 'remote')?.tone).toBe('active');
  });

  it('distinguishes smtp success from pending remote sent archive', () => {
    const queuedMessage = validationMessage({
      id: 12,
      folder_id: 4,
      folder_role: 'outbox',
      subject: '[Better Email 验收] validation-002',
      has_attachments: false,
      attachment_count: 0,
      remote_mailbox: '',
      remote_uid: 0,
    });
    const outboxItem: OutboxItem = {
      id: 5,
      message_id: queuedMessage.id,
      recipients: account.email,
      subject: queuedMessage.subject,
      status: 'sent_remote_pending',
      attempts: 1,
      last_error: 'temporary append failure',
      queued_at: '2026-07-10T13:14:15.000Z',
      next_attempt_at: '2026-07-10T13:19:15.000Z',
    };
    const status = buildProviderWriteValidationStatus(
      'validation-002',
      [queuedMessage],
      [outboxItem],
    );

    expect(status?.stages.find((stage) => stage.id === 'smtp')?.tone).toBe('passed');
    expect(status?.stages.find((stage) => stage.id === 'archive')?.tone).toBe('warning');
    expect(status?.stages.find((stage) => stage.id === 'receipt')?.tone).toBe('pending');
    expect(status?.receivedMessageId).toBeNull();
    expect(status?.complete).toBe(false);
  });
});
