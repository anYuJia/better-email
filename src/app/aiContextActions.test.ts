import { describe, expect, it } from 'vitest';
import type { Message } from './types';
import {
  aiContextActions,
  buildAiReplyPrompt,
  buildComposerPolishPrompt,
  normalizeGeneratedReply,
  readerAiSource,
} from './aiContextActions';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 7,
    account_id: 1,
    account_email: 'me@example.com',
    folder_id: 1,
    folder_role: 'inbox',
    sender_name: 'Ada',
    sender_email: 'ada@example.com',
    recipients: 'me@example.com',
    cc: '',
    bcc: '',
    subject: 'Project update',
    snippet: 'Fallback snippet',
    body: 'Hello,\nThe launch is Friday.',
    sanitized_html: '',
    security_warnings: [],
    received_at: '2026-08-27T00:00:00Z',
    is_read: true,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: 7,
    ...overrides,
  };
}

describe('AI context actions', () => {
  it('defines reader and composer actions without creating a separate AI surface', () => {
    expect(aiContextActions.map((action) => action.id)).toEqual([
      'summarize', 'reply', 'translate', 'polish',
    ]);
  });

  it('prefers rendered mail body and falls back to the summary snippet', () => {
    expect(readerAiSource(message())).toContain('launch is Friday');
    expect(readerAiSource(message({ body: '', sanitized_html: '' }))).toBe('Fallback snippet');
  });

  it('builds a constrained reply prompt from the current message', () => {
    const prompt = buildAiReplyPrompt(message());
    expect(prompt).toContain('来信人：Ada');
    expect(prompt).toContain('主题：Project update');
    expect(prompt).toContain('不要虚构事实');
  });

  it('extracts a generated template body for direct reply prefilling', () => {
    const output = normalizeGeneratedReply(
      '主题：Re: Project update\n正文：\n您好 {{contact.name}}，\n\n已收到。\n\n{{account.email}}',
      message(),
    );
    expect(output).toBe('您好 Ada，\n\n已收到。');
  });

  it('builds a fact-preserving composer polish prompt', () => {
    const prompt = buildComposerPolishPrompt('周五 10:00 发布。');
    expect(prompt).toContain('不要新增未提供的信息');
    expect(prompt).toContain('周五 10:00 发布。');
  });
});
