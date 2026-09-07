import { spawn } from 'node:child_process';

export function probeExecutable(executable, { spawnProcess = spawn, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timer;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(available);
    };
    try {
      child = spawnProcess(executable, ['--version'], { stdio: 'ignore' });
      child.once('error', () => finish(false));
      child.once('exit', (code) => finish(code === 0));
      timer = setTimeout(() => {
        finish(false);
        child.kill('SIGKILL');
      }, timeoutMs);
    } catch {
      finish(false);
    }
  });
}

export async function findBrowserExecutable(candidates, options) {
  for (const candidate of candidates) {
    if (candidate && await probeExecutable(candidate, options)) return candidate;
  }
  throw new Error('Chrome/Chromium executable not found; set CHROME_PATH to run UI smoke tests.');
}
