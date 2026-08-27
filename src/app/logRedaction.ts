const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const ASSIGNMENT_PATTERN = /\b(password|passwd|secret|token|access_token|refresh_token|api[_-]?key|client[_-]?secret|authorization[_-]?code|credential)\s*[:=]\s*([^\s,;]+)/gi;
const SENSITIVE_KEY_PATTERN = /^(authorization|password|passwd|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|authorization[_-]?code|credential)$/i;

export function redactSensitiveText(value: string) {
  return value
    .replace(BEARER_PATTERN, 'Bearer [redacted]')
    .replace(ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=[redacted]`)
    .replace(EMAIL_PATTERN, '[email]');
}

export function redactLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (depth >= 5) return '[truncated]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveText(value.message),
      stack: value.stack ? redactSensitiveText(value.stack) : undefined,
    };
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item, depth + 1, seen));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return redactSensitiveText(String(value));
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? '[redacted]'
      : redactLogValue(entry, depth + 1, seen);
  }
  return output;
}
