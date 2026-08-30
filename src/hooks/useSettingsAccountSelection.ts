import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { emptyIdentityForm } from '../app/appConfig';
import { replaceAccountScopedItems } from '../app/accountConnectionSettings';
import type {
  Account,
  CredentialStatus,
  CredentialVerificationReport,
  Folder,
  MailIdentity,
  MailIdentityInput,
  RemoteImageTrust,
} from '../app/types';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';

type SettingsAccountSelectionOptions = {
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setIdentityForm: Dispatch<SetStateAction<MailIdentityInput>>;
  setCredentialSecret: Dispatch<SetStateAction<string>>;
  setCredentialStatus: Dispatch<SetStateAction<CredentialStatus | null>>;
  setCredentialVerification: Dispatch<SetStateAction<CredentialVerificationReport | null>>;
  setRemoteImageTrusts: Dispatch<SetStateAction<RemoteImageTrust[]>>;
  setIdentities: Dispatch<SetStateAction<MailIdentity[]>>;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useSettingsAccountSelection({
  setAccountForm,
  setIdentityForm,
  setCredentialSecret,
  setCredentialStatus,
  setCredentialVerification,
  setRemoteImageTrusts,
  setIdentities,
  setFolders,
  setStatus,
}: SettingsAccountSelectionOptions) {
  const requestRef = useRef(0);

  return useCallback((next: Account) => {
    const requestId = ++requestRef.current;
    setAccountForm(next);
    setIdentityForm(emptyIdentityForm);
    setCredentialSecret('');
    setCredentialStatus(null);
    setCredentialVerification(null);
    Promise.all([
      invoke<RemoteImageTrust[]>(IPC.ListRemoteImageTrusts, { accountId: next.id }),
      invoke<MailIdentity[]>(IPC.ListIdentities, { accountId: next.id }),
      invoke<Folder[]>(IPC.ListFolders, { accountId: next.id }),
      invoke<CredentialStatus>(IPC.CheckAccountSecret, { accountEmail: next.email }),
    ])
      .then(([trusts, identities, folders, credentialStatus]) => {
        if (requestId !== requestRef.current) return;
        setRemoteImageTrusts((current) => replaceAccountScopedItems(current, trusts, next.id));
        setIdentities((current) => replaceAccountScopedItems(current, identities, next.id));
        setFolders((current) => replaceAccountScopedItems(current, folders, next.id));
        setCredentialStatus(credentialStatus);
      })
      .catch((error) => {
        if (requestId === requestRef.current) setStatus(String(error));
      });
  }, [
    setAccountForm,
    setCredentialSecret,
    setCredentialStatus,
    setCredentialVerification,
    setFolders,
    setIdentities,
    setIdentityForm,
    setRemoteImageTrusts,
    setStatus,
  ]);
}
