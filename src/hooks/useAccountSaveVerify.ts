import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  type SaveAndVerifyReport,
  type SaveAndVerifyStageState,
  emptySaveAndVerifyReport,
  authTypeChangeMessage,
  updateSaveAndVerifyReportStage,
} from '../app/accountConnectionSettings';
import { credentialVerificationPatch } from '../app/accountConnectionFlows';
import type {
  Account,
  ConnectionReport,
  CredentialStatus,
  CredentialVerificationReport,
  ProviderVerificationRecord,
} from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type AccountSaveVerifyOptions = {
  accountForm: Account | null;
  persistedAccountForm: Account | null;
  authTypeChanged: boolean;
  updateProviderVerification: (
    providerName: string,
    patch: Partial<ProviderVerificationRecord>,
  ) => void;
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setConnectionReport: Dispatch<SetStateAction<ConnectionReport | null>>;
  setCredentialStatus: Dispatch<SetStateAction<CredentialStatus | null>>;
  setCredentialVerification: Dispatch<SetStateAction<CredentialVerificationReport | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useAccountSaveVerify({
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
}: AccountSaveVerifyOptions) {
  const [saveAndVerifyReport, setSaveAndVerifyReport] = useState<SaveAndVerifyReport>(emptySaveAndVerifyReport());
  const [saveAndVerifyRunning, setSaveAndVerifyRunning] = useState(false);
  const [accountSettingsSaving, setAccountSettingsSaving] = useState(false);
  const saveAndVerifyRunId = useRef(0);

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
    const updated = await invoke<Account>(IPC.UpdateAccountSettings, {
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
      const connection = await invoke<ConnectionReport>(IPC.TestConnection, { accountId: updated.id });
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
      const credential = await invoke<CredentialStatus>(IPC.CheckAccountSecret, {
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
      const verification = await invoke<CredentialVerificationReport>(IPC.VerifyAccountCredentials, {
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

  return {
    saveAndVerifyReport,
    saveAndVerifyRunning,
    accountSettingsSaving,
    resetSaveAndVerifyReport,
    persistAccountSettings,
    saveSettings,
    saveAndVerify,
  };
}
