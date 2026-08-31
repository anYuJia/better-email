import type {
  AccountScopedSettingKey,
  AccountScopedSettingValue,
} from '../../app/accountScopedSettings';

export type SettingsAccountValues = Record<AccountScopedSettingKey, AccountScopedSettingValue>;
export type SettingsAccountValueChange = (
  key: AccountScopedSettingKey,
  value: string | boolean,
) => void;
