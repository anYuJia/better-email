import { spawn } from 'node:child_process';

const SUCCESS_MARKER = /\n\s*"status"\s*:\s*"ok"\s*,/;
const SUCCESS_EXIT_GRACE_MS = Number(process.env.BETTER_EMAIL_UI_SMOKE_EXIT_GRACE_MS ?? 5000);
const FORCE_KILL_GRACE_MS = 1500;

const child = spawn(process.execPath, ['scripts/ui-smoke.mjs'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});

let tail = '';
let successSeen = false;
let forcedAfterSuccess = false;
let successTimer = null;
let hardKillTimer = null;

function terminateTree(force) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

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

function observe(chunk, stream) {
  stream.write(chunk);
  tail = `${tail}${chunk.toString()}`.slice(-16_384);
  if (successSeen || !SUCCESS_MARKER.test(tail)) return;

  successSeen = true;
  successTimer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    forcedAfterSuccess = true;
    console.warn(
      `[ui-smoke-runner] assertions passed but the smoke process did not exit within ${SUCCESS_EXIT_GRACE_MS}ms; terminating leaked browser/dev-server processes`,
    );
    terminateTree(false);
    hardKillTimer = setTimeout(() => terminateTree(true), FORCE_KILL_GRACE_MS);
  }, SUCCESS_EXIT_GRACE_MS);
}

child.stdout.on('data', (chunk) => observe(chunk, process.stdout));
child.stderr.on('data', (chunk) => observe(chunk, process.stderr));

child.on('error', (error) => {
  console.error('[ui-smoke-runner] failed to start UI smoke:', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (successTimer) clearTimeout(successTimer);
  if (hardKillTimer) clearTimeout(hardKillTimer);

  if (successSeen && forcedAfterSuccess) {
    console.log('[ui-smoke-runner] successful smoke run cleaned up after process leak');
    process.exitCode = 0;
    return;
  }

  if (code !== null) {
    process.exitCode = code;
    return;
  }

  if (successSeen) {
    process.exitCode = 0;
    return;
  }

  console.error(`[ui-smoke-runner] UI smoke exited before success (signal=${signal ?? 'unknown'})`);
  process.exitCode = 1;
});
