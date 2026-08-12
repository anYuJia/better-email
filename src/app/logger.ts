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

/**
 * 本机时区时间戳，格式固定为 `YYYY-MM-DD HH:mm:ss.SSS ±HH:MM`，
 * 与 Rust 端 `src-tauri/src/logging.rs` 的 `%Y-%m-%d %H:%M:%S%.3f %:z` 完全一致。
 * 时间戳在日志实际输出时生成，不缓存事件开始时间。
 */
export function formatLogTimestamp(date: Date = new Date()): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetAbs = Math.abs(offsetMinutes);
  const yyyy = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const sss = pad(date.getMilliseconds(), 3);
  const offHH = pad(Math.floor(offsetAbs / 60));
  const offMM = pad(offsetAbs % 60);
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${sss} ${sign}${offHH}:${offMM}`;
}

/**
 * 统一日志入口：在输出时生成时间戳前缀，并保留原有日志级别。
 * 第一个参数为字符串时作为正文；否则（如直接传入 Error）原样透传，仅追加时间戳。
 */
function stampArgs(args: unknown[]): unknown[] {
  if (args.length === 0) return [`[${formatLogTimestamp()}]`];
  const [first, ...rest] = args;
  if (typeof first === 'string') {
    return [`[${formatLogTimestamp()}] ${first}`, ...rest];
  }
  return [`[${formatLogTimestamp()}]`, ...args];
}

export function logInfo(...args: unknown[]) {
  console.info(...stampArgs(args));
}

export function logWarn(...args: unknown[]) {
  console.warn(...stampArgs(args));
}

export function logError(...args: unknown[]) {
  console.error(...stampArgs(args));
}

export function logDebug(...args: unknown[]) {
  console.debug(...stampArgs(args));
}

export function logLine(...args: unknown[]) {
  console.log(...stampArgs(args));
}

export function flowInfo(scope: string, event: string, details: Record<string, unknown> = {}) {
  if (!verboseFlowLogsEnabled()) return;
  logInfo(`[${scope}] ${event}`, details);
}

export function flowWarn(scope: string, event: string, details: Record<string, unknown> = {}) {
  logWarn(`[${scope}] ${event}`, details);
}

export function diagnosticInfo(prefix: string, event: string, details: Record<string, unknown> = {}) {
  if (!verboseFlowLogsEnabled()) return;
  logInfo(`${prefix} ${event}`, details);
}

export function diagnosticWarn(prefix: string, event: string, details: Record<string, unknown> = {}) {
  logWarn(`${prefix} ${event}`, details);
}
