import type { AccountScope } from './types';

export const DEFAULT_SETTINGS_SECTION = 'general';

export type SettingsWindowRequest = {
  section?: string;
  accountScope?: AccountScope;
};

export const SETTINGS_WINDOW_LABEL = 'settings';
export const SETTINGS_OPEN_EVENT = 'better-email:settings-open';
export const SETTINGS_READY_EVENT = 'better-email:settings-ready';
export const SETTINGS_READY_QUERY_EVENT = 'better-email:settings-ready-query';
export const SETTINGS_CLOSED_EVENT = 'better-email:settings-closed';
export const SETTINGS_ACCOUNT_SCOPE_EVENT = 'better-email:settings-account-scope';
export const SETTINGS_ACCOUNTS_UPDATED_EVENT = 'better-email:settings-accounts-updated';
