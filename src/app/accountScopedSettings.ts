import type { Account } from './types';

/**
 * Settings that are safe to edit while the mailbox scope is "all".
 * Connection details, credentials, identities and folder mappings deliberately
 * do not appear here because they belong to one concrete mailbox.
 */
export const accountScopedSettingKeys = [
  'sync_mode',
  'remote_images_allowed',
  'warn_external_senders',
  'cross_account_risk_warning',
  'block_external_mailboxes',
  'intercept_https_links',
  'auto_download_attachments',
] as const;

export type AccountScopedSettingKey = typeof accountScopedSettingKeys[number];
export const MIXED_ACCOUNT_SETTING_VALUE = '__mixed__' as const;
export type MixedAccountSettingValue = typeof MIXED_ACCOUNT_SETTING_VALUE;

export type AccountScopedSettingPatch = Partial<Pick<
  Account,
  AccountScopedSettingKey
>>;

export type AccountScopedSettingValue =
  | AccountScopedSettingPatch[AccountScopedSettingKey]
  | MixedAccountSettingValue
  | undefined;

export type AccountSettingUpdateFailure = {
  account: Account;
  error: unknown;
};

export type AccountSettingUpdateSkip = {
  account: Account;
  fields: AccountScopedSettingKey[];
};

export type AccountSettingUpdateResult = {
  updated: Account[];
  failed: AccountSettingUpdateFailure[];
  skipped: AccountSettingUpdateSkip[];
};

function settingValueForAccount<K extends AccountScopedSettingKey>(
  account: Account,
  key: K,
): Account[K] {
  if (key === 'sync_mode' && account.sync_mode === 'push') {
    return '5min' as Account[K];
  }
  return account[key];
}

/** Returns the common value or an explicit mixed marker for a set of accounts. */
export function accountSettingValue<K extends AccountScopedSettingKey>(
  accounts: readonly Account[],
  key: K,
): Account[K] | MixedAccountSettingValue | undefined {
  if (accounts.length === 0) return undefined;
  const first = settingValueForAccount(accounts[0], key);
  return accounts.every((account) => Object.is(settingValueForAccount(account, key), first))
    ? first
    : MIXED_ACCOUNT_SETTING_VALUE;
}

/** Builds a full IPC input while changing only fields edited in this scope. */
export function accountWithChangedSettings(
  account: Account,
  patch: AccountScopedSettingPatch,
  changedFields: Iterable<AccountScopedSettingKey>,
): Account {
  const changed = new Set(changedFields);
  const next = { ...account };
  accountScopedSettingKeys.forEach((key) => {
    if (changed.has(key) && patch[key] !== undefined) {
      next[key] = patch[key] as never;
    }
  });
  return next;
}

export type ApplyAccountScopedSettingsOptions = {
  accounts: readonly Account[];
  patch: AccountScopedSettingPatch;
  changedFields: Iterable<AccountScopedSettingKey>;
  updateAccount: (account: Account, input: Account) => Promise<Account>;
  /** Providers may opt out of a field without preventing other accounts from saving. */
  isSettingSupported?: (account: Account, key: AccountScopedSettingKey) => boolean;
};

/**
 * Applies the changed fields independently for every account. The full account
 * object is required by the existing IPC contract, so each input starts from
 * that account's own persisted values instead of a representative account.
 */
export async function applyAccountScopedSettings({
  accounts,
  patch,
  changedFields,
  updateAccount,
  isSettingSupported = () => true,
}: ApplyAccountScopedSettingsOptions): Promise<AccountSettingUpdateResult> {
  const fields = [...new Set(changedFields)];
  const skipped: AccountSettingUpdateSkip[] = [];
  const tasks = accounts.flatMap((account) => {
    const supportedFields = fields.filter((key) => isSettingSupported(account, key));
    const skippedFields = fields.filter((key) => !supportedFields.includes(key));
    if (skippedFields.length > 0) skipped.push({ account, fields: skippedFields });
    if (supportedFields.length === 0) return [];
    const input = accountWithChangedSettings(account, patch, supportedFields);
    return [{ account, input }];
  });

  const settled = await Promise.allSettled(
    tasks.map(({ account, input }) => updateAccount(account, input)),
  );
  const updated: Account[] = [];
  const failed: AccountSettingUpdateFailure[] = [];
  settled.forEach((result, index) => {
    const account = tasks[index].account;
    if (result.status === 'fulfilled') updated.push(result.value);
    else failed.push({ account, error: result.reason });
  });
  return { updated, failed, skipped };
}

export function accountScopeDisplayName(
  accountScope: number | 'all',
  accounts: readonly Account[],
): string | null {
  if (accountScope === 'all') return accounts.length > 0 ? '所有邮箱账号' : null;
  const account = accounts.find((candidate) => candidate.id === accountScope);
  if (!account) return null;
  return account.display_name.trim() || account.email;
}
