import { spawn } from 'node:child_process';

const SUCCESS_MARKER = /\n\s*"status"\s*:\s*"ok"\s*,/;
const FAILURE_MARKER = /UI smoke failed at /;
const TRANSIENT_RELOAD_MARKER = /Inspected target navigated or closed/;
const SUCCESS_EXIT_GRACE_MS = Number(process.env.BETTER_EMAIL_UI_SMOKE_EXIT_GRACE_MS ?? 5000);
const FAILURE_EXIT_GRACE_MS = Number(process.env.BETTER_EMAIL_UI_SMOKE_FAILURE_EXIT_GRACE_MS ?? 5000);
const FORCE_KILL_GRACE_MS = 1500;
const MAX_TRANSIENT_RETRIES = Number(process.env.BETTER_EMAIL_UI_SMOKE_TRANSIENT_RETRIES ?? 1);

let child = null;
let attempt = 0;
let tail = '';
let successSeen = false;
let forcedAfterSuccess = false;
let failureSeen = false;
let transientReloadFailure = false;
let successTimer = null;
let failureTimer = null;
let hardKillTimer = null;

function clearTimers() {
  if (successTimer) clearTimeout(successTimer);
  if (failureTimer) clearTimeout(failureTimer);
  if (hardKillTimer) clearTimeout(hardKillTimer);
  successTimer = null;
  failureTimer = null;
  hardKillTimer = null;
}

function terminateTree(force) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32') {
    const args = ['/pid', String(child.pid), '/T'];
    if (force) args.push('/F');
    const killer = spawn('taskkill', args, { stdio: 'ignore' });
    killer.unref();
    return;
  }

  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function scheduleTreeCleanup(reason, graceMs) {
  if (failureTimer || successTimer) return;
  const timer = setTimeout(() => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    console.warn(`[ui-smoke-runner] ${reason}; terminating leaked browser/dev-server processes`);
    terminateTree(false);
    hardKillTimer = setTimeout(() => terminateTree(true), FORCE_KILL_GRACE_MS);
  }, graceMs);

  if (successSeen) successTimer = timer;
  else failureTimer = timer;
}

function observe(chunk, stream) {
  stream.write(chunk);
  tail = `${tail}${chunk.toString()}`.slice(-32_768);

  if (!successSeen && SUCCESS_MARKER.test(tail)) {
    successSeen = true;
    forcedAfterSuccess = false;
    scheduleTreeCleanup(
      `assertions passed but the smoke process did not exit within ${SUCCESS_EXIT_GRACE_MS}ms`,
      SUCCESS_EXIT_GRACE_MS,
    );
    return;
  }

  if (!failureSeen && FAILURE_MARKER.test(tail)) {
    failureSeen = true;
    scheduleTreeCleanup(
      `smoke failed but the process did not exit within ${FAILURE_EXIT_GRACE_MS}ms`,
      FAILURE_EXIT_GRACE_MS,
    );
  }

  if (FAILURE_MARKER.test(tail) && TRANSIENT_RELOAD_MARKER.test(tail)) {
    transientReloadFailure = true;
  }
}

function startAttempt() {
  attempt += 1;
  tail = '';
  successSeen = false;
  forcedAfterSuccess = false;
  failureSeen = false;
  transientReloadFailure = false;
  clearTimers();

  if (attempt > 1) {
    console.warn(`[ui-smoke-runner] retrying UI smoke after transient reload race (${attempt}/${MAX_TRANSIENT_RETRIES + 1})`);
  }

  child = spawn(process.execPath, ['scripts/ui-smoke.mjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  child.stdout.on('data', (chunk) => observe(chunk, process.stdout));
  child.stderr.on('data', (chunk) => observe(chunk, process.stderr));

  child.on('error', (error) => {
    console.error('[ui-smoke-runner] failed to start UI smoke:', error);
    process.exitCode = 1;
  });

  child.on('exit', (code, signal) => {
    const passed = successSeen;
    const wasTransientReloadFailure = transientReloadFailure;
    clearTimers();

    if (passed && forcedAfterSuccess) {
      console.log('[ui-smoke-runner] successful smoke run cleaned up after process leak');
      process.exitCode = 0;
      return;
    }

    if (passed) {
      process.exitCode = 0;
      return;
    }

    if (wasTransientReloadFailure && attempt <= MAX_TRANSIENT_RETRIES) {
      startAttempt();
      return;
    }

    if (code !== null) {
      process.exitCode = code;
      return;
    }

    console.error(`[ui-smoke-runner] UI smoke exited before success (signal=${signal ?? 'unknown'})`);
    process.exitCode = 1;
  });
}

startAttempt();
