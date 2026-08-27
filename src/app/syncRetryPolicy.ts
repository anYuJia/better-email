export const SYNC_RETRY_BASE_DELAY_MS = 5_000;
export const SYNC_RETRY_MAX_DELAY_MS = 5 * 60_000;

/**
 * Timer sync retry delay with exponential backoff and bounded jitter.
 *
 * The delay is capped by both the configured sync interval and five minutes,
 * so transient failures recover quickly without turning into a retry storm.
 */
export function syncRetryDelayMs(
  attempt: number,
  normalIntervalMs: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const safeInterval = Number.isFinite(normalIntervalMs) && normalIntervalMs > 0
    ? normalIntervalMs
    : SYNC_RETRY_MAX_DELAY_MS;
  const cap = Math.max(
    SYNC_RETRY_BASE_DELAY_MS,
    Math.min(safeInterval, SYNC_RETRY_MAX_DELAY_MS),
  );
  const exponential = Math.min(
    cap,
    SYNC_RETRY_BASE_DELAY_MS * (2 ** Math.min(safeAttempt - 1, 10)),
  );
  const boundedRandom = Math.min(Math.max(random(), 0), 1);
  const jitterMultiplier = 0.8 + boundedRandom * 0.4;
  return Math.max(
    SYNC_RETRY_BASE_DELAY_MS,
    Math.min(cap, Math.round(exponential * jitterMultiplier)),
  );
}
