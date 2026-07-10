import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(new URL('..', import.meta.url).pathname);
const platformBinaryName = process.platform === 'win32' ? 'better-email.exe' : 'better-email';
const execFileAsync = promisify(execFile);
const sampleApp = process.argv.includes('--sample-app');
const sampleSync = process.argv.includes('--sample-sync');
const appSampleMs = Number(
  process.env.BETTER_EMAIL_BENCH_SAMPLE_MS
  ?? process.env.SWIFTMAIL_BENCH_SAMPLE_MS
  ?? 5000,
);

function bytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function walkSize(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (stat.isFile()) return stat.size;
  return readdirSync(path).reduce((total, name) => total + walkSize(join(path, name)), 0);
}

function fileCount(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (stat.isFile()) return 1;
  return readdirSync(path).reduce((total, name) => total + fileCount(join(path, name)), 0);
}

function artifactSummary(path) {
  const exists = existsSync(path);
  return {
    path,
    exists,
    files: fileCount(path),
    size: bytes(walkSize(path)),
  };
}

function fileSummary(path) {
  const exists = existsSync(path);
  return {
    path,
    exists,
    size: bytes(walkSize(path)),
  };
}

function listFiles(path, predicate, limit = 20) {
  if (!existsSync(path)) return [];
  const stat = statSync(path);
  if (stat.isFile()) return predicate(path) ? [path] : [];
  if (predicate(path)) return [path];
  const matches = [];
  for (const name of readdirSync(path)) {
    if (matches.length >= limit) break;
    matches.push(...listFiles(join(path, name), predicate, limit - matches.length));
  }
  return matches;
}

function bundleArtifacts(path) {
  return listFiles(
    path,
    (candidate) => {
      const extension = extname(candidate).toLowerCase();
      return ['.app', '.dmg', '.msi', '.deb', '.appimage'].includes(extension);
    },
    20,
  ).map((candidate) => ({
    name: basename(candidate),
    ...artifactSummary(candidate),
  }));
}

function frontendAssets(path) {
  return listFiles(path, (candidate) => statSync(candidate).isFile(), 50)
    .map((candidate) => ({
      name: candidate.replace(`${path}/`, ''),
      size_bytes: statSync(candidate).size,
      size: bytes(statSync(candidate).size),
    }))
    .sort((a, b) => b.size_bytes - a.size_bytes)
    .slice(0, 8)
    .map(({ size_bytes: _sizeBytes, ...asset }) => asset);
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rss: bytes(usage.rss),
    heapUsed: bytes(usage.heapUsed),
    external: bytes(usage.external),
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

async function processRssBytes(pid) {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `(Get-Process -Id ${pid}).WorkingSet64`,
    ]);
    return Number(stdout.trim());
  }
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
  const rssKb = Number(stdout.trim());
  return Number.isFinite(rssKb) ? rssKb * 1024 : 0;
}

async function waitForReadyFile(path, launchStart, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (existsSync(path)) {
      let payload = null;
      try {
        payload = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        payload = { parse_error: true };
      }
      return {
        detected: true,
        ready_ms: Number((performance.now() - launchStart).toFixed(2)),
        payload,
      };
    }
    await sleep(50);
  }
  return {
    detected: false,
    timeout_ms: timeoutMs,
  };
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { parse_error: true };
  }
}

async function collectRssSamples(pid, sampleMs, intervalMs = 100) {
  const samples = [];
  const deadline = performance.now() + sampleMs;
  while (performance.now() < deadline) {
    try {
      const rss = await processRssBytes(pid);
      if (rss > 0) {
        samples.push({
          elapsed_ms: Number((performance.now()).toFixed(2)),
          rss,
        });
      }
    } catch {
      break;
    }
    await sleep(intervalMs);
  }
  const peak = samples.reduce((max, sample) => Math.max(max, sample.rss), 0);
  return {
    samples: samples.length,
    peak_rss: peak,
    peak_rss_human: bytes(peak),
  };
}

async function sampleReleaseApp(binaryPath, sampleMs, options = {}) {
  if (!existsSync(binaryPath)) {
    return {
      attempted: false,
      reason: 'release binary missing; run `npm run bench:release` first',
    };
  }

  const launchStart = performance.now();
  const readyDir = mkdtempSync(join(tmpdir(), 'better-email-bench-ready-'));
  const readyFile = join(readyDir, 'frontend-ready.json');
  const syncFile = join(readyDir, 'sync-complete.json');
  const child = spawn(binaryPath, [], {
    cwd: root,
    stdio: 'ignore',
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      BETTER_EMAIL_BENCH_READY_FILE: readyFile,
      BETTER_EMAIL_BENCH_SYNC_FILE: syncFile,
      BETTER_EMAIL_BENCH_SYNC: options.sampleSync ? '1' : '',
    },
  });
  const exitPromise = waitForExit(child);
  const pid = child.pid;
  if (!pid) {
    return {
      attempted: true,
      started: false,
      reason: 'process did not expose a pid',
    };
  }

  try {
    const sampleDelayMs = Math.max(250, sampleMs);
    const readyPromise = waitForReadyFile(readyFile, launchStart, sampleDelayMs);
    const syncPromise = options.sampleSync
      ? waitForReadyFile(syncFile, launchStart, sampleDelayMs)
      : Promise.resolve(null);
    const peakPromise = collectRssSamples(pid, sampleDelayMs);
    const earlyExit = await Promise.race([exitPromise, sleep(sampleDelayMs).then(() => null)]);
    if (earlyExit) {
      const startupReady = existsSync(readyFile)
        ? await waitForReadyFile(readyFile, launchStart, 1)
        : { detected: false, reason: 'app exited before frontend ready marker was written' };
      const syncSample = options.sampleSync
        ? existsSync(syncFile)
          ? { detected: true, payload: readJsonFile(syncFile) }
          : { detected: false, reason: 'app exited before sync marker was written' }
        : null;
      const peakRss = await peakPromise;
      return {
        attempted: true,
        started: true,
        exited_early: true,
        pid,
        sample_ms: sampleDelayMs,
        exit_code: earlyExit.code,
        exit_signal: earlyExit.signal,
        launch_wait_ms: Number((performance.now() - launchStart).toFixed(2)),
        startup_ready: startupReady,
        sync_sample: syncSample,
        peak_rss_sample: peakRss,
        reason: 'release app exited before RSS sample could be collected',
      };
    }
    const startupReady = await readyPromise;
    const syncSample = await syncPromise;
    const peakRss = await peakPromise;
    const rss = await processRssBytes(pid);
    return {
      attempted: true,
      started: true,
      pid,
      sample_ms: sampleDelayMs,
      launch_wait_ms: Number((performance.now() - launchStart).toFixed(2)),
      startup_ready: startupReady,
      sync_sample: syncSample,
      peak_rss_sample: peakRss,
      rss,
      rss_human: bytes(rss),
    };
  } catch (error) {
    return {
      attempted: true,
      started: true,
      pid,
      sample_ms: sampleMs,
      error: String(error),
    };
  } finally {
    try {
      if (process.platform === 'win32') {
        child.kill();
      } else {
        process.kill(-pid, 'SIGTERM');
      }
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Best-effort cleanup only.
      }
    }
    rmSync(readyDir, { recursive: true, force: true });
  }
}

const start = performance.now();
const distPath = join(root, 'dist');
const targetDebugBinaryPath = join(root, 'src-tauri', 'target', 'debug', platformBinaryName);
const targetReleasePath = join(root, 'src-tauri', 'target', 'release');
const targetReleaseBinaryPath = join(targetReleasePath, platformBinaryName);
const targetReleaseBundlePath = join(targetReleasePath, 'bundle');
const sqlitePath = join(root, 'src-tauri', 'target', 'debug', 'better-email-test.sqlite3');
const releaseBinaryExists = existsSync(targetReleaseBinaryPath);
const bundlePathExists = existsSync(targetReleaseBundlePath);
const gaps = [];

if (!releaseBinaryExists) {
  gaps.push('release binary is missing; run `npm run bench:release` for a real app binary size sample');
}
if (!bundlePathExists) {
  gaps.push('Tauri bundle artifacts are missing; run `npm run tauri:build` when installer/package size is needed');
}
if (existsSync(targetReleasePath)) {
  gaps.push('cargo_release_dir_cache is a build cache, not the user-facing app size; prefer tauri_release_binary and tauri_bundles');
}
if (!existsSync(sqlitePath)) {
  gaps.push('sample SQLite file is not present because current tests use temporary databases');
}
if (!sampleApp) {
  gaps.push('idle app RSS and startup readiness were not sampled; run `npm run bench:app` after building release');
}
if (!sampleSync) {
  gaps.push('sync peak RSS was not sampled; run `npm run bench:sync` after building release');
}

const report = {
  measured_at: new Date().toISOString(),
  elapsed_ms: Number((performance.now() - start).toFixed(2)),
  frontend_dist: artifactSummary(distPath),
  frontend_assets_largest: frontendAssets(distPath),
  tauri_debug_binary: fileSummary(targetDebugBinaryPath),
  tauri_release_binary: fileSummary(targetReleaseBinaryPath),
  cargo_release_dir_cache: artifactSummary(targetReleasePath),
  tauri_bundles: bundleArtifacts(targetReleaseBundlePath),
  sample_sqlite: {
    path: sqlitePath,
    exists: existsSync(sqlitePath),
    size: bytes(walkSize(sqlitePath)),
  },
  node_process_memory: memorySnapshot(),
  measurement_gaps: gaps,
};

if (sampleApp) {
  report.release_app_idle_sample = await sampleReleaseApp(targetReleaseBinaryPath, appSampleMs, {
    sampleSync,
  });
}

console.log(JSON.stringify(report, null, 2));
