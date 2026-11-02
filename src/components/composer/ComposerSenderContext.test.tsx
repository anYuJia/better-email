import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account, MailIdentity } from '../../app/types';
import { ComposerSenderContext } from './ComposerAdvancedTools';

const account = (id: number, display_name: string, email: string) => ({ id, display_name, email } as Account);
const identity = (id: number, account_id: number, name: string, email: string, reply_to = ''): MailIdentity => ({
  id, account_id, name, email, reply_to, is_default: true, signature: '',
});
afterEach(cleanup);

describe('ComposerSenderContext distinct sender information', () => {
  it('does not repeat an identity name as its account source', () => {
    render(<ComposerSenderContext accounts={[account(1, 'Demo User', 'demo@example.com'), account(2, '其他', 'other@example.com')]}
      identities={[identity(11, 1, 'Demo User', 'demo@example.com')]} accountId={1} identityId={11} onPatchDraft={vi.fn()} />);
    const text = screen.getByRole('combobox', { name: '发件人' }).textContent!;
    expect(text.match(/Demo User/g)).toHaveLength(1);
    expect(text).toContain('<demo@example.com>');
  });

  it('distinguishes the same alias across identically named accounts and selects the correct account', () => {
    const patch = vi.fn();
    render(<ComposerSenderContext accounts={[account(1, '工作', 'one@example.com'), account(2, '工作', 'two@example.com')]}
      identities={[identity(11, 1, 'Support', 'alias@example.com'), identity(22, 2, 'Support', 'alias@example.com')]}
      accountId={1} identityId={11} onPatchDraft={patch} />);
    fireEvent.click(screen.getByRole('combobox', { name: '发件人' }));
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('one@example.com');
    expect(options[1].textContent).toContain('two@example.com');
    fireEvent.click(options[1]);
    expect(patch).toHaveBeenCalledExactlyOnceWith({ account_id: 2, identity_id: 22 });
  });

  it('keeps distinct account and Reply-To context for aliases', () => {
    render(<ComposerSenderContext accounts={[account(1, '工作', 'work@example.com'), account(2, '个人', 'personal@example.com')]}
      identities={[identity(11, 1, '客服', 'support@example.com', 'replies@example.com')]}
      accountId={1} identityId={11} onPatchDraft={vi.fn()} />);
    const text = screen.getByRole('combobox', { name: '发件人' }).textContent!;
    expect(text).toContain('客服');
    expect(text).toContain('support@example.com');
    expect(text).toContain('工作');
    expect(text).toContain('回复至: replies@example.com');
  });

  it.each([{ identities: [] }, { identities: [identity(11, 1, '', 'demo@example.com')] }])('shows an address once when it is also the visible sender name (%j)', ({ identities }) => {
    render(<ComposerSenderContext accounts={[account(1, '', 'demo@example.com')]} identities={identities}
      accountId={1} identityId={11} onPatchDraft={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: '发件人' }).textContent!.match(/demo@example.com/g)).toHaveLength(1);
  });
});
