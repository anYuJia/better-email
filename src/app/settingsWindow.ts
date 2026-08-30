export type SettingsWindowRequest = {
  section?: string;
};

export const SETTINGS_WINDOW_LABEL = 'settings';
export const SETTINGS_OPEN_EVENT = 'better-email:settings-open';
export const SETTINGS_READY_EVENT = 'better-email:settings-ready';
export const SETTINGS_READY_QUERY_EVENT = 'better-email:settings-ready-query';
export const SETTINGS_CLOSED_EVENT = 'better-email:settings-closed';
