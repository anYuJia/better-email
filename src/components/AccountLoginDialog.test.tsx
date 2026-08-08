import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { emptyAccountCreateForm } from '../app/appConfig';
import type { AccountCreateInput } from '../app/types';
import AccountLoginDialog from './AccountLoginDialog';

function LoginHarness({ onSubmit = vi.fn(async () => undefined) }: {
  onSubmit?: (secret: string, onProgress: (stage: string) => void) => Promise<unknown>;
}) {
  const [form, setForm] = useState<AccountCreateInput>(emptyAccountCreateForm);
  return <AccountLoginDialog form={form} onFormChange={setForm} onSubmit={onSubmit} />;
}

describe('AccountLoginDialog', () => {
  afterEach(() => cleanup());

  it('is a non-dismissible login gate', () => {
    render(<LoginHarness />);

    expect(screen.getByRole('dialog', { name: '登录邮箱' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();
    expect(screen.getByRole('button', { name: '登录并同步' })).toHaveProperty('disabled', true);
  });

  it('recognizes a provider and submits the authorization code through the existing flow', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<LoginHarness onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('邮箱地址'), { target: { value: 'ada@qq.com' } });
    await waitFor(() => expect(screen.getByText('QQ 邮箱')).not.toBeNull());
    fireEvent.change(screen.getByLabelText('授权码 / 应用密码'), { target: { value: 'mail-code' } });
    fireEvent.click(screen.getByRole('button', { name: '登录并同步' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('mail-code', expect.any(Function));
    });
  });

  it('keeps server configuration available without expanding the initial form', () => {
    render(<LoginHarness />);

    expect(screen.queryByPlaceholderText('imap.example.com:993')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '服务器设置' }));
    expect(screen.getByPlaceholderText('imap.example.com:993')).not.toBeNull();
    expect(screen.getByPlaceholderText('smtp.example.com:465')).not.toBeNull();
  });

  it('keeps POP3 and OAuth2 setup available in the compact advanced section', () => {
    render(<LoginHarness />);

    fireEvent.change(screen.getByLabelText('邮箱地址'), { target: { value: 'ada@qq.com' } });
    fireEvent.click(screen.getByRole('button', { name: '服务器设置' }));
    fireEvent.change(screen.getByLabelText('收信协议'), { target: { value: 'pop3' } });
    fireEvent.change(screen.getByLabelText('登录方式'), { target: { value: 'oauth2' } });

    expect(screen.getByLabelText('收信服务器')).toHaveProperty('value', 'pop.qq.com:995');
    expect(screen.getByLabelText('OAuth2 Token')).not.toBeNull();
  });

  it('keeps keyboard focus inside the login dialog', () => {
    render(<LoginHarness />);

    const dialog = screen.getByRole('dialog', { name: '登录邮箱' });
    screen.getByRole('button', { name: '服务器设置' }).focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });

    expect(document.activeElement).toBe(screen.getByLabelText('邮箱地址'));
  });

  it('restores existing background accessibility state after unmounting', () => {
    const { unmount } = render(
      <>
        <div data-testid="background" aria-hidden="false" />
        <LoginHarness />
      </>,
    );
    const background = screen.getByTestId('background');

    expect(background.getAttribute('aria-hidden')).toBe('true');
    expect(background.hasAttribute('inert')).toBe(true);
    unmount();
    expect(background.getAttribute('aria-hidden')).toBe('false');
    expect(background.hasAttribute('inert')).toBe(false);
  });

  it('finishes submitting under React StrictMode', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <StrictMode>
        <LoginHarness onSubmit={onSubmit} />
      </StrictMode>,
    );

    fireEvent.change(screen.getByLabelText('邮箱地址'), { target: { value: 'ada@qq.com' } });
    fireEvent.change(screen.getByLabelText('授权码 / 应用密码'), { target: { value: 'mail-code' } });
    fireEvent.click(screen.getByRole('button', { name: '登录并同步' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(screen.getByRole('button', { name: '登录并同步' })).toHaveProperty('disabled', false);
    });
  });
});
