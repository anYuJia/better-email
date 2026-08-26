import type { DraftInput } from './types';

export type ComposerWindowRequest = {
  draft?: DraftInput;
  restoreAutosave?: boolean;
  replaceExisting?: boolean;
};

export type NativeCloseRequestEvent = {
  preventDefault: () => void;
};

export const COMPOSER_WINDOW_LABEL = 'composer';
export const COMPOSER_OPEN_EVENT = 'better-email:composer-open';
export const COMPOSER_CLOSED_EVENT = 'better-email:composer-closed';
export const COMPOSER_CONTACTS_SETTINGS_EVENT = 'better-email:composer-contacts-settings';
