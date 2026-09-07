import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Account, CredentialStatus, CredentialVerificationReport } from '../app/types';
import { notifyCredentialsChanged } from '../app/credentialEvents';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type CredentialManagementOptions = {
  account: Account | null;
  credentialStatus: CredentialStatus | null;
  setCredentialStatus: Dispatch<SetStateAction<CredentialStatus | null>>;
  setCredentialVerification: Dispatch<SetStateAction<CredentialVerificationReport | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  verifyAccountCredentials: () => Promise<CredentialVerificationReport>;
};

export default function useCredentialManagement({
  account, credentialStatus, setCredentialStatus, setCredentialVerification,
  setStatus, verifyAccountCredentials,
}: CredentialManagementOptions) {
  const [credentialSecret, setCredentialSecret] = useState('');
  const [credentialBusy, setCredentialBusy] = useState(false);
  const scope = `${account?.id}:${account?.email}:${account?.auth_type}`;
  const contextRef = useRef({ scope, generation: 0 });
  const operationRef = useRef<Promise<CredentialStatus | null> | null>(null);
  const inputRef = useRef(credentialSecret);
  inputRef.current = credentialSecret;
  if (contextRef.current.scope !== scope) {
    contextRef.current = { scope, generation: contextRef.current.generation + 1 };
    operationRef.current = null;
  }
  useEffect(() => {
    setCredentialSecret('');
    setCredentialBusy(false);
    return () => { contextRef.current.generation += 1; };
  }, [scope]);

  function operate(kind: 'save' | 'verify' | 'delete') {
    if (operationRef.current) return operationRef.current;
    if (!account?.email) {
      setStatus('账号尚未加载，无法操作凭据');
      return Promise.resolve(null);
    }
    const target = account;
    const input = credentialSecret;
    if (kind !== 'delete' && !input.trim()) {
      setStatus(target.auth_type === 'oauth2' ? '请输入 OAuth2 Token JSON' : '请输入应用专用密码或授权码');
      return Promise.resolve(null);
    }
    const generation = contextRef.current.generation;
    const isCurrent = () => contextRef.current.scope === scope && contextRef.current.generation === generation;
    setCredentialBusy(true);
    const pending = (async () => {
      try {
        const result = kind === 'delete'
          ? await invoke<CredentialStatus>(IPC.DeleteAccountSecret, { accountEmail: target.email })
          : await invoke<CredentialStatus>(IPC.StoreAccountSecret, {
            accountId: target.id,
            authType: target.auth_type,
            input: { account_email: target.email, secret: input },
          });
        notifyCredentialsChanged();
        if (!isCurrent()) return result;
        setCredentialStatus(result);
        setCredentialVerification(null);
        setStatus(result.message);
        const succeeded = kind === 'delete'
          ? result.status === 'deleted' || result.status === 'not_found'
          : result.exists;
        if (!succeeded) return result;
        if (inputRef.current === input) setCredentialSecret('');
        if (kind === 'verify' && isCurrent()) await verifyAccountCredentials();
        return result;
      } catch (error) {
        if (!isCurrent()) return null;
        setStatus(`凭据操作失败：${String(error)}`);
        throw error;
      } finally {
        if (isCurrent()) {
          operationRef.current = null;
          setCredentialBusy(false);
        }
      }
    })();
    operationRef.current = pending;
    return pending;
  }

  return {
    credentialSecret, setCredentialSecret, credentialStatus, setCredentialStatus, credentialBusy,
    storeCredential: () => operate('save'),
    storeAndVerifyCredential: () => operate('verify'),
    deleteCredential: () => operate('delete'),
  };
}
