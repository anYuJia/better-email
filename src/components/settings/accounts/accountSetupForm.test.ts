import { describe, expect, it } from 'vitest';
import { emptyAccountCreateForm } from '../../../app/appConfig';
import {
  accountFormForEmail,
  accountFormForIncomingProtocol,
} from './accountSetupForm';

describe('account setup form helpers', () => {
  it('fills the QQ preset from an email address', () => {
    expect(accountFormForEmail(emptyAccountCreateForm, 'ada@qq.com')).toMatchObject({
      email: 'ada@qq.com',
      display_name: 'QQ 邮箱',
      provider: 'qq',
      imap_host: 'imap.qq.com:993',
      smtp_host: 'smtp.qq.com:587',
      auth_type: 'password',
    });
  });

  it('keeps custom domains editable while filling common server defaults', () => {
    const custom = accountFormForEmail(emptyAccountCreateForm, 'ada@example.com');
    expect(custom).toMatchObject({
      provider: 'Custom',
      imap_host: 'imap.example.com:993',
      smtp_host: 'smtp.example.com:465',
    });
    expect(accountFormForIncomingProtocol(custom, 'pop3').imap_host).toBe('pop.example.com:995');
  });
});
