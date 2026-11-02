import { emitToMain } from '../tauriBridge';

export const CREDENTIALS_CHANGED_EVENT = 'better-email:credentials-changed';

export function notifyCredentialsChanged() {
  window.dispatchEvent(new Event(CREDENTIALS_CHANGED_EVENT));
  void Promise.resolve().then(() => emitToMain(CREDENTIALS_CHANGED_EVENT)).catch(() => undefined);
}
