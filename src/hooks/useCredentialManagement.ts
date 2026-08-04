import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Account, CredentialStatus, CredentialVerificationReport } from '../app/types';
import { invoke } from '../tauriBridge';

type CredentialManagementOptions = {
  account: Account | null;
  credentialStatus: CredentialStatus | null;
  setCredentialStatus: Dispatch<SetStateAction<CredentialStatus | null>>;
  setCredentialVerification: Dispatch<SetStateAction<CredentialVerificationReport | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  verifyAccountCredentials: () => Promise<CredentialVerificationReport>;
};

export default function useCredentialManagement({
  account,
  credentialStatus,
  setCredentialStatus,
  setCredentialVerification,
  setStatus,
  verifyAccountCredentials,
}: CredentialManagementOptions) {
  const [credentialSecret, setCredentialSecret] = useState('');

  async function storeCredential() {
    if (!account?.email) {
      setStatus('账号尚未加载，无法保存凭据');
      return null;
    }
    if (!credentialSecret.trim()) {
      setStatus(account.auth_type === 'oauth2' ? '请输入 OAuth2 访问/刷新 Token' : '请输入应用专用密码或授权码');
      return null;
    }
    const result = await invoke<CredentialStatus>('store_account_secret', {
      input: { account_email: account.email, secret: credentialSecret },
    });
    setCredentialStatus(result);
    setCredentialVerification(null);
    setCredentialSecret('');
    setStatus(result.message);
    return result;
  }

  async function storeAndVerifyCredential() {
    const result = await storeCredential();
    if (!result?.exists) return;
    await verifyAccountCredentials();
  }

  async function checkCredential() {
    if (!account?.email) return;
    const result = await invoke<CredentialStatus>('check_account_secret', {
      accountEmail: account.email,
    });
    setCredentialStatus(result);
    setStatus(result.message);
  }

  async function deleteCredential() {
    if (!account?.email) return;
    const result = await invoke<CredentialStatus>('delete_account_secret', {
      accountEmail: account.email,
    });
    setCredentialStatus(result);
    setCredentialVerification(null);
    setCredentialSecret('');
    setStatus(result.message);
  }

  return {
    credentialSecret,
    setCredentialSecret,
    credentialStatus,
    setCredentialStatus,
    storeCredential,
    storeAndVerifyCredential,
    checkCredential,
    deleteCredential,
  };
}
