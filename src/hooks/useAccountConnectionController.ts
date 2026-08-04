import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { emptyAccountCreateForm } from '../app/appConfig';
import {
  authTypeChangeMessage,
  isAccountConnectionDirty,
} from '../app/accountConnectionSettings';
import {
  credentialVerificationPatch,
  providerVerificationRecordFor,
} from '../app/accountConnectionFlows';
import type {
  Account,
  AccountCreateInput,
  AccountScope,
  Attachment,
  ConnectionReport,
  CredentialStatus,
  CredentialVerificationReport,
  FilterMode,
  Folder,
  ImapMailboxState,
  ImapProbeReport,
  MessageSummary,
  ProviderVerificationRecord,
  SearchScope,
  SyncRun,
} from '../app/types';
import {
  incomingHostForProtocol,
  type AccountProviderPreset,
} from '../providerCatalog';
import { invoke } from '../tauriBridge';
import useAccountProvisioning from './useAccountProvisioning';
import useAccountSaveVerify from './useAccountSaveVerify';
import useAccountSyncOperations from './useAccountSyncOperations';

type LoadMetaResult = {
  folderId: number | null;
  folders: Folder[];
};

type UseAccountConnectionControllerOptions = {
  accounts: Account[];
  accountForm: Account | null;
  newAccountForm: AccountCreateInput;
  providerVerifications: Record<string, ProviderVerificationRecord>;
  diagnosticExport: string | null;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setAccountScope: Dispatch<SetStateAction<AccountScope>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setNewAccountForm: Dispatch<SetStateAction<AccountCreateInput>>;
  setFolderId: Dispatch<SetStateAction<number | null>>;
  setMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setProviderVerifications: Dispatch<SetStateAction<Record<string, ProviderVerificationRecord>>>;
  setConnectionReport: Dispatch<SetStateAction<ConnectionReport | null>>;
  setCredentialVerification: Dispatch<SetStateAction<CredentialVerificationReport | null>>;
  setCredentialStatus: Dispatch<SetStateAction<CredentialStatus | null>>;
  setImapProbe: Dispatch<SetStateAction<ImapProbeReport | null>>;
  setImapMailboxes: Dispatch<SetStateAction<ImapMailboxState[]>>;
  setSyncRuns: Dispatch<SetStateAction<SyncRun[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  loadMeta: (nextFolderId?: number | null, nextScope?: AccountScope) => Promise<LoadMetaResult>;
  loadMessages: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
    refreshId?: number,
    nextLimit?: number,
    nextSearchScope?: SearchScope,
  ) => Promise<MessageSummary[]>;
};

export default function useAccountConnectionController({
  accounts,
  accountForm,
  newAccountForm,
  providerVerifications,
  diagnosticExport,
  folderId,
  query,
  filter,
  setAccount,
  setAccounts,
  setAccountScope,
  setAccountForm,
  setNewAccountForm,
  setFolderId,
  setMessages,
  setSelectedId,
  setAttachments,
  setSettingsOpen,
  setProviderVerifications,
  setConnectionReport,
  setCredentialVerification,
  setCredentialStatus,
  setImapProbe,
  setImapMailboxes,
  setSyncRuns,
  setStatus,
  loadMeta,
  loadMessages,
}: UseAccountConnectionControllerOptions) {
  const persistedAccountForm = useMemo(
    () => accounts.find((item) => item.id === accountForm?.id) ?? null,
    [accounts, accountForm?.id],
  );
  const isDirty = useMemo(
    () => isAccountConnectionDirty(persistedAccountForm, accountForm),
    [persistedAccountForm, accountForm],
  );

  const authTypeChanged = useMemo(() => {
    if (!persistedAccountForm || !accountForm) return false;
    return (persistedAccountForm.auth_type ?? '').trim().toLowerCase() !== (accountForm.auth_type ?? '').trim().toLowerCase();
  }, [persistedAccountForm, accountForm]);
  const authTypeChangeNotice = useMemo(
    () => authTypeChangeMessage(persistedAccountForm?.auth_type, accountForm?.auth_type),
    [persistedAccountForm?.auth_type, accountForm?.auth_type],
  );

  const providerVerificationFor = useCallback(
    (providerName: string) => providerVerificationRecordFor(providerName, providerVerifications),
    [providerVerifications],
  );

  const updateProviderVerification = useCallback((
    providerName: string,
    patch: Partial<ProviderVerificationRecord>,
  ) => {
    const current = providerVerificationFor(providerName);
    setProviderVerifications((records) => ({
      ...records,
      [current.provider_key]: {
        ...current,
        ...patch,
        checked_at: patch.checked_at ?? current.checked_at,
      },
    }));
  }, [providerVerificationFor, setProviderVerifications]);

  const activeProviderVerification = useMemo(
    () => (accountForm ? providerVerificationFor(accountForm.provider) : null),
    [accountForm, providerVerificationFor],
  );

  const {
    saveAndVerifyReport,
    saveAndVerifyRunning,
    accountSettingsSaving,
    resetSaveAndVerifyReport,
    persistAccountSettings,
    saveSettings,
    saveAndVerify,
  } = useAccountSaveVerify({
    accountForm,
    persistedAccountForm,
    authTypeChanged,
    updateProviderVerification,
    setAccount,
    setAccounts,
    setAccountForm,
    setConnectionReport,
    setCredentialStatus,
    setCredentialVerification,
    setStatus,
  });

  const {
    createNewAccount,
    removeCurrentAccount,
    setDefaultAccount,
  } = useAccountProvisioning({
    accounts,
    accountForm,
    newAccountForm,
    query,
    filter,
    setAccount,
    setAccounts,
    setAccountScope,
    setAccountForm,
    setNewAccountForm,
    setFolderId,
    setMessages,
    setSelectedId,
    setAttachments,
    setSettingsOpen,
    setCredentialStatus,
    setCredentialVerification,
    setSyncRuns,
    setStatus,
    loadMeta,
    loadMessages,
  });
  const {
    providerValidationReport,
    providerValidationRunning,
    discoverImapFolders,
    runReadOnlyProviderValidation,
    mapImapMailbox,
    createAndMapImapMailbox,
    runSyncDryRun,
    syncImapHistoryPage,
  } = useAccountSyncOperations({
    accountForm,
    folderId,
    query,
    filter,
    setConnectionReport,
    setCredentialVerification,
    setImapProbe,
    setImapMailboxes,
    setSyncRuns,
    setStatus,
    updateProviderVerification,
    loadMeta,
    loadMessages,
  });

  const applyProviderPreset = useCallback((preset: AccountProviderPreset) => {
    setAccountForm((current) => (
      current
        ? {
            ...current,
            provider: preset.provider,
            imap_host: incomingHostForProtocol(preset, current.incoming_protocol),
            smtp_host: preset.smtp_host,
            auth_type: preset.auth_type,
          }
        : current
    ));
    setStatus(`${preset.label} 服务商预设已填入，可继续保存和测试连接`);
  }, [setAccountForm, setStatus]);

  const applyNewAccountPreset = useCallback((preset: AccountProviderPreset) => {
    setNewAccountForm((current) => ({
      ...current,
      provider: preset.provider,
      imap_host: incomingHostForProtocol(preset, current.incoming_protocol),
      smtp_host: preset.smtp_host,
      auth_type: preset.auth_type,
    }));
    setStatus(`${preset.label} 预设已填入新账号表单`);
  }, [setNewAccountForm, setStatus]);

  const saveProviderVerification = useCallback(() => {
    if (!accountForm) return;
    updateProviderVerification(accountForm.provider, {
      checked_at: new Date().toISOString(),
      diagnostic_exported: Boolean(diagnosticExport),
    });
    setStatus('服务商兼容性验证记录已保存到本地');
  }, [accountForm, diagnosticExport, setStatus, updateProviderVerification]);

  const testConnection = useCallback(async () => {
    const report = await invoke<ConnectionReport>('test_connection', { accountId: accountForm?.id });
    setConnectionReport(report);
    setStatus(
      report.ready_for_credentials
        ? '服务器连接成功；账号是否可登录仍需点击“验证登录”'
        : '服务器测试完成，请查看网络结果',
    );
    return report;
  }, [accountForm?.id, setConnectionReport, setStatus]);

  const verifyAccountCredentials = useCallback(async () => {
    const report = await invoke<CredentialVerificationReport>('verify_account_credentials', {
      accountId: accountForm?.id,
    });
    setCredentialVerification(report);
    if (accountForm && report.status !== 'credential_error') {
      updateProviderVerification(
        accountForm.provider,
        credentialVerificationPatch(report, accountForm.auth_type),
      );
    }
    setStatus(report.message);
    return report;
  }, [
    accountForm,
    setCredentialVerification,
    setStatus,
    updateProviderVerification,
  ]);

  return {
    activeProviderVerification,
    providerValidationReport,
    providerValidationRunning,
    isDirty,
    authTypeChanged,
    authTypeChangeNotice,
    accountSettingsSaving,
    saveAndVerifyReport,
    saveAndVerifyRunning,
    resetSaveAndVerifyReport,
    updateProviderVerification,
    saveSettings,
    saveAndVerify,
    createNewAccount,
    removeCurrentAccount,
    setDefaultAccount,
    applyProviderPreset,
    applyNewAccountPreset,
    saveProviderVerification,
    testConnection,
    verifyAccountCredentials,
    discoverImapFolders,
    runReadOnlyProviderValidation,
    mapImapMailbox,
    createAndMapImapMailbox,
    runSyncDryRun,
    syncImapHistoryPage,
  };
}
