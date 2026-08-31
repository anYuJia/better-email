import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Account, AccountScope } from '../app/types';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';
import {
  accountScopedSettingKeys,
  accountSettingValue,
  applyAccountScopedSettings,
  type AccountScopedSettingKey,
  type AccountScopedSettingPatch,
  type AccountScopedSettingValue,
  type AccountSettingUpdateResult,
  MIXED_ACCOUNT_SETTING_VALUE,
} from '../app/accountScopedSettings';

type UseAccountScopedSettingsOptions = {
  accountScope: AccountScope;
  accounts: Account[];
  setAccount: Dispatch<SetStateAction<Account | null>>;
  setAccounts: Dispatch<SetStateAction<Account[]>>;
  setAccountForm: Dispatch<SetStateAction<Account | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function useAccountScopedSettings({
  accountScope,
  accounts,
  setAccount,
  setAccounts,
  setAccountForm,
  setStatus,
}: UseAccountScopedSettingsOptions) {
  const [patch, setPatch] = useState<AccountScopedSettingPatch>({});
  const [changedFields, setChangedFields] = useState<Set<AccountScopedSettingKey>>(new Set());
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<AccountSettingUpdateResult | null>(null);

  useEffect(() => {
    setPatch({});
    setChangedFields(new Set());
    setLastResult(null);
  }, [accountScope]);

  const values = useMemo(() => (
    Object.fromEntries(
      accountScopedSettingKeys.map((key) => [
        key,
        changedFields.has(key) ? patch[key] : accountSettingValue(accounts, key),
      ]),
    ) as Record<AccountScopedSettingKey, AccountScopedSettingValue>
  ), [accounts, changedFields, patch]);

  const updateSetting = useCallback((
    key: AccountScopedSettingKey,
    value: Exclude<AccountScopedSettingValue, typeof MIXED_ACCOUNT_SETTING_VALUE | undefined>,
  ) => {
    if (accountScope !== 'all') return;
    const commonValue = accountSettingValue(accounts, key);
    const returnsToCommonValue = commonValue !== MIXED_ACCOUNT_SETTING_VALUE
      && commonValue !== undefined
      && Object.is(commonValue, value);
    setPatch((current) => {
      if (!returnsToCommonValue) return { ...current, [key]: value };
      const next = { ...current };
      delete next[key];
      return next;
    });
    setChangedFields((current) => {
      const next = new Set(current);
      if (returnsToCommonValue) next.delete(key);
      else next.add(key);
      return next;
    });
    setLastResult(null);
  }, [accountScope, accounts]);

  const discardChanges = useCallback(() => {
    setPatch({});
    setChangedFields(new Set());
    setLastResult(null);
  }, []);

  const save = useCallback(async () => {
    if (
      accountScope !== 'all'
      || changedFields.size === 0
      || accounts.length === 0
      || saving
    ) return null;

    setSaving(true);
    try {
      const result = await applyAccountScopedSettings({
        accounts,
        patch,
        changedFields,
        updateAccount: (_account, input) => invoke<Account>(IPC.UpdateAccountSettings, {
          accountId: input.id,
          input,
        }),
      });
      const updatedById = new Map(result.updated.map((account) => [account.id, account]));
      if (result.updated.length > 0) {
        setAccounts((current) => current.map((account) => updatedById.get(account.id) ?? account));
        setAccount((current) => current ? updatedById.get(current.id) ?? current : current);
        setAccountForm((current) => current ? updatedById.get(current.id) ?? current : current);
      }
      setLastResult(result);
      if (result.failed.length === 0) {
        discardChanges();
      }
      if (result.failed.length > 0) {
        setStatus(`已更新 ${result.updated.length} 个账号，${result.failed.length} 个账号未更新：${errorMessage(result.failed[0].error)}`);
      } else if (result.skipped.length > 0) {
        setStatus(`已更新 ${result.updated.length} 个账号，部分服务商不支持这些设置`);
      } else {
        setStatus('统一账号设置已保存');
      }
      return result;
    } catch (error) {
      setStatus(`统一账号设置保存失败：${errorMessage(error)}`);
      return null;
    } finally {
      setSaving(false);
    }
  }, [
    accountScope,
    accounts,
    changedFields,
    discardChanges,
    patch,
    saving,
    setAccount,
    setAccountForm,
    setAccounts,
    setStatus,
  ]);

  return {
    values,
    changedFields,
    isDirty: accountScope === 'all' && changedFields.size > 0,
    saving,
    lastResult,
    updateSetting,
    save,
    discardChanges,
  };
}
