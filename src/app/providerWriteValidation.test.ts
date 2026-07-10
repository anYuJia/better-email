import { describe, expect, it } from 'vitest';
import {
  buildProviderWriteValidationDraft,
  createProviderWriteValidationId,
} from './providerWriteValidation';
import type { Account } from './types';

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
});
