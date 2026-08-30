import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type {
  Account,
  CredentialStatus,
  CredentialVerificationReport,
  Folder,
  MailIdentity,
  MailIdentityInput,
  RemoteImageTrust,
} from '../app/types';
import useSettingsAccountSelection from './useSettingsAccountSelection';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));

import { invoke } from '../tauriBridge';

const mockInvoke = vi.mocked(invoke);

function account(id: number): Account {
  return {
    id,
    email: `account-${id}@example.com`,
    display_name: `账号 ${id}`,
    provider: 'custom',
    imap_host: 'imap.example.com:993',
    smtp_host: 'smtp.example.com:587',
    incoming_protocol: 'imap',
    auth_type: 'password',
    sync_mode: 'manual',
    remote_images_allowed: false,
    signature: '',
    cross_account_risk_warning: true,
    block_external_mailboxes: false,
    intercept_https_links: true,
    auto_download_attachments: false,
    warn_external_senders: false,
    onboarding_completed: true,
    is_default: id === 1,
  };
}

const initialIdentityForm: MailIdentityInput = {
  id: 9,
  account_id: 1,
  name: '正在编辑',
  email: 'editing@example.com',
  reply_to: '',
  signature: '',
  is_default: false,
};

function useHarness() {
  const [accountForm, setAccountForm] = useState<Account | null>(account(1));
  const [identityForm, setIdentityForm] = useState(initialIdentityForm);
  const [credentialSecret, setCredentialSecret] = useState('secret');
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [, setCredentialVerification] = useState<CredentialVerificationReport | null>(null);
  const [remoteImageTrusts, setRemoteImageTrusts] = useState<RemoteImageTrust[]>([]);
  const [identities, setIdentities] = useState<MailIdentity[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [status, setStatus] = useState('');
  const select = useSettingsAccountSelection({
    setAccountForm,
    setIdentityForm,
    setCredentialSecret,
    setCredentialStatus,
    setCredentialVerification,
    setRemoteImageTrusts,
    setIdentities,
    setFolders,
    setStatus,
  });
  return {
    select,
    accountForm,
    identityForm,
    credentialSecret,
    credentialStatus,
    remoteImageTrusts,
    identities,
    folders,
    status,
  };
}

describe('useSettingsAccountSelection', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'list_remote_image_trusts') return Promise.resolve([
        { id: 1, account_id: 1, account_email: 'account-1@example.com', scope: 'sender', value: 'old@example.com', created_at: '' },
        { id: 2, account_id: 2, account_email: 'account-2@example.com', scope: 'domain', value: 'example.com', created_at: '' },
      ]);
      if (command === 'list_identities') return Promise.resolve([
        { id: 1, account_id: 1, name: '旧身份', email: 'old@example.com', reply_to: '', signature: '', is_default: true },
        { id: 2, account_id: 2, name: '账号 2', email: 'account-2@example.com', reply_to: '', signature: '', is_default: true },
      ]);
      if (command === 'list_folders') return Promise.resolve([
        { id: 101, account_id: 1, name: '旧收件箱', role: 'inbox', unread_count: 0, is_virtual: false },
        { id: 201, account_id: 2, name: '收件箱', role: 'inbox', unread_count: 0, is_virtual: false },
      ]);
      if (command === 'check_account_secret') return Promise.resolve({
        account_email: 'account-2@example.com',
        exists: true,
        status: 'stored',
        message: '已保存',
      });
      return Promise.reject(new Error(`unexpected command: ${command}`));
    }) as never);
  });

  it('loads only the selected account scope and clears the previous editing state', async () => {
    const { result } = renderHook(() => useHarness());

    act(() => result.current.select(account(2)));

    expect(result.current.accountForm?.id).toBe(2);
    expect(result.current.credentialSecret).toBe('');
    expect(result.current.identityForm).toMatchObject({ id: 0, account_id: 0, name: '' });
    await waitFor(() => expect(result.current.credentialStatus?.account_email).toBe('account-2@example.com'));
    expect(result.current.remoteImageTrusts.map((item) => item.account_id)).toEqual([2]);
    expect(result.current.identities.map((item) => item.account_id)).toEqual([2]);
    expect(result.current.folders.map((item) => item.account_id)).toEqual([2]);
    expect(result.current.status).toBe('');
  });
});
