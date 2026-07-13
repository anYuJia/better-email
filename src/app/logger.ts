const verboseLogStorageKey = 'better-email.verbose-flow-logs';

export function verboseFlowLogsEnabled(
  isDev = import.meta.env.DEV,
  storage: Pick<Storage, 'getItem'> | null = typeof window === 'undefined' ? null : window.localStorage,
) {
  if (isDev) return true;
  if (!storage) return false;
  try {
    return storage.getItem(verboseLogStorageKey) === '1';
  } catch {
    return false;
  }
}

export function flowInfo(scope: string, event: string, details: Record<string, unknown> = {}) {
  if (!verboseFlowLogsEnabled()) return;
  console.info(`[${scope}] ${event}`, details);
}

export function flowWarn(scope: string, event: string, details: Record<string, unknown> = {}) {
  console.warn(`[${scope}] ${event}`, details);
}

export function diagnosticInfo(prefix: string, event: string, details: Record<string, unknown> = {}) {
  if (!verboseFlowLogsEnabled()) return;
  console.info(prefix, event, details);
}

export function diagnosticWarn(prefix: string, event: string, details: Record<string, unknown> = {}) {
  console.warn(prefix, event, details);
}
