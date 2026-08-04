import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { emptyAccountCreateForm } from '../app/appConfig';
import {
  type SaveAndVerifyReport,
  type SaveAndVerifyStageState,
  emptySaveAndVerifyReport,
  authTypeChangeMessage,
  isAccountConnectionDirty,
  updateSaveAndVerifyReportStage,
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
  const [saveAndVerifyReport, setSaveAndVerifyReport] = useState<SaveAndVerifyReport>(emptySaveAndVerifyReport());
  const [saveAndVerifyRunning, setSaveAndVerifyRunning] = useState(false);
  const [accountSettingsSaving, setAccountSettingsSaving] = useState(false);
  const saveAndVerifyRunId = useRef(0);
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

  const resetSaveAndVerifyReport = useCallback(() => {
    setSaveAndVerifyReport(emptySaveAndVerifyReport());
  }, []);

  useEffect(() => {
    saveAndVerifyRunId.current += 1;
    setSaveAndVerifyRunning(false);
    resetSaveAndVerifyReport();
    setConnectionReport(null);
    setCredentialVerification(null);
  }, [
    accountForm?.id,
    resetSaveAndVerifyReport,
    setConnectionReport,
    setCredentialVerification,
  ]);

  useEffect(() => {
    if (authTypeChanged) {
      setCredentialVerification(null);
    }
  }, [authTypeChanged, setCredentialVerification]);

  const applySavedAccount = useCallback((updated: Account) => {
    setAccount(updated);
    setAccountForm(updated);
    setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }, [setAccount, setAccountForm, setAccounts]);

  const persistAccountSettings = useCallback(async (draft: Account) => {
    const updated = await invoke<Account>('update_account_settings', {
      accountId: draft.id,
      input: draft,
    });
    applySavedAccount(updated);
    return updated;
  }, [applySavedAccount]);

  const saveSettings = useCallback(async (): Promise<Account | null> => {
    if (!accountForm || accountSettingsSaving || saveAndVerifyRunning) return null;
    setAccountSettingsSaving(true);
    try {
      const updated = await persistAccountSettings(accountForm);
      setStatus('账号和同步设置已保存');
      return updated;
    } catch (error) {
      setStatus(`账号设置保存失败：${String(error)}`);
      throw error;
    } finally {
      setAccountSettingsSaving(false);
    }
  }, [
    accountForm,
    accountSettingsSaving,
    persistAccountSettings,
    saveAndVerifyRunning,
    setStatus,
  ]);

  const saveAndVerify = useCallback(async (): Promise<SaveAndVerifyReport | null> => {
    if (!accountForm || saveAndVerifyRunning || accountSettingsSaving) return null;
    const draft = accountForm;
    const runId = ++saveAndVerifyRunId.current;
    const authChangedBeforeSave = authTypeChanged;
    let activeStage: SaveAndVerifyReport['stages'][number]['id'] = 'save';
    let report = emptySaveAndVerifyReport();

    const publish = (
      stageId: SaveAndVerifyReport['stages'][number]['id'],
      state: SaveAndVerifyStageState,
      detail: string,
      technicalDetail?: string,
    ) => {
      report = updateSaveAndVerifyReportStage(report, stageId, state, detail, {
        authType: draft.auth_type,
        authTypeChanged: authChangedBeforeSave,
        technicalDetail,
      });
      if (saveAndVerifyRunId.current === runId) {
        setSaveAndVerifyReport(report);
      }
    };

    setSaveAndVerifyRunning(true);
    setConnectionReport(null);
    setCredentialVerification(null);
    setSaveAndVerifyReport(report);

    try {
      publish('save', 'running', '正在保存当前配置');
      const updated = await persistAccountSettings(draft);
      if (saveAndVerifyRunId.current !== runId) return null;
      publish('save', 'success', '配置已保存');

      activeStage = 'server';
      publish('server', 'running', '正在检查收信与发信服务器');
      const connection = await invoke<ConnectionReport>('test_connection', { accountId: updated.id });
      if (saveAndVerifyRunId.current !== runId) return null;
      setConnectionReport(connection);
      const reachableCount = connection.endpoints.filter((endpoint) => endpoint.reachable).length;
      const serverState: SaveAndVerifyStageState = reachableCount === connection.endpoints.length
        ? 'success'
        : reachableCount > 0
          ? 'partial'
          : 'error';
      publish(
        'server',
        serverState,
        serverState === 'success'
          ? '收信与发信服务器均可连接'
          : serverState === 'partial'
            ? '仅部分服务器可连接'
            : '服务器连接失败',
        connection.endpoints.map((endpoint) => (
          `${endpoint.name} ${endpoint.address}: ${endpoint.message}`
        )).join('\n'),
      );
      if (serverState === 'error') {
        setStatus(report.summary);
        return report;
      }

      activeStage = 'credential';
      publish('credential', 'running', '正在检查系统凭据');
      const credential = await invoke<CredentialStatus>('check_account_secret', {
        accountEmail: updated.email,
      });
      if (saveAndVerifyRunId.current !== runId) return null;
      setCredentialStatus(credential);

      if (authChangedBeforeSave) {
        publish('credential', 'needs_auth', authTypeChangeMessage(
          persistedAccountForm?.auth_type,
          draft.auth_type,
        ) ?? '认证方式已修改，需要重新认证');
        publish('incoming', 'needs_auth', '等待重新认证');
        publish('smtp', 'needs_auth', '等待重新认证');
        setStatus(report.summary);
        return report;
      }

      if (!credential.exists) {
        publish(
          'credential',
          'needs_auth',
          draft.auth_type === 'oauth2' ? '尚未保存 OAuth2 Token' : '尚未保存客户端授权码',
        );
        publish('incoming', 'needs_auth', '等待保存凭据');
        publish('smtp', 'needs_auth', '等待保存凭据');
        setStatus(report.summary);
        return report;
      }
      publish('credential', 'success', '系统凭据已保存');

      activeStage = 'incoming';
      publish('incoming', 'running', '正在验证收信登录');
      publish('smtp', 'running', '正在验证发信登录');
      const verification = await invoke<CredentialVerificationReport>('verify_account_credentials', {
        accountId: updated.id,
      });
      if (saveAndVerifyRunId.current !== runId) return null;
      setCredentialVerification(verification);
      const incomingCheck = verification.checks.find((check) => {
        const name = check.name.toLowerCase();
        return name.includes('imap') || name.includes('pop3');
      });
      const smtpCheck = verification.checks.find((check) => check.name.toLowerCase() === 'smtp');
      publish(
        'incoming',
        incomingCheck?.authenticated ? 'success' : 'error',
        incomingCheck?.authenticated ? '收信认证成功' : '收信认证失败',
        incomingCheck?.message,
      );
      activeStage = 'smtp';
      publish(
        'smtp',
        smtpCheck?.authenticated ? 'success' : 'error',
        smtpCheck?.authenticated ? '发信认证成功' : '发信认证失败',
        smtpCheck?.message,
      );
      if (verification.status !== 'credential_error') {
        updateProviderVerification(
          updated.provider,
          credentialVerificationPatch(verification, updated.auth_type),
        );
      }
      setStatus(report.summary);
      return report;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publish(activeStage, 'error', '操作失败', message);
      setStatus(`保存并验证失败：${message}`);
      return report;
    } finally {
      if (saveAndVerifyRunId.current === runId) {
        setSaveAndVerifyRunning(false);
      }
    }
  }, [
    accountForm,
    accountSettingsSaving,
    authTypeChanged,
    persistAccountSettings,
    persistedAccountForm?.auth_type,
    saveAndVerifyRunning,
    setConnectionReport,
    setCredentialStatus,
    setCredentialVerification,
    setStatus,
    updateProviderVerification,
  ]);
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
