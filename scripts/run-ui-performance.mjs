import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runInteractionPerformance } from './ui-performance-probe.mjs';

// Uses a fresh nonpersistent WKWebView and a separate mock Vite server. Never
// start the production Tauri binary here: its bootstrap opens real app data.
const root = new URL('..', import.meta.url).pathname;
const port = Number(process.env.BETTER_EMAIL_PERF_PORT ?? 1431);
const output = resolve(process.env.BETTER_EMAIL_PERF_OUTPUT ?? '/tmp/better-email-webkit-performance.json');
const repeats = Number(process.env.BETTER_EMAIL_PERF_REPEATS ?? 3);
const messageCount = Number(process.env.BETTER_EMAIL_PERF_MESSAGES ?? 5000);
if (platform() !== 'darwin') throw new Error('This harness requires macOS system WebKit');
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('Invalid repeats');
if (!Number.isInteger(messageCount) || messageCount < 10 || messageCount > 50000) throw new Error('Invalid message count');
const temp = mkdtempSync(join(tmpdir(), 'better-email-native-perf-'));
const children = [];
const spawnTracked = (command, args, options = {}) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  children.push(child); return child;
};
const completion = child => new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Child exited ${code ?? signal}`)));
});
try {
  mkdirSync(dirname(output), { recursive: true });
  const binary = join(temp, 'native-webkit-perf');
  console.log('[native-perf] Compiling isolated system WebKit shell');
  await completion(spawnTracked('xcrun', ['swiftc', 'scripts/native-webkit-perf.swift', '-o', binary]));
  const url = `http://127.0.0.1:${port}`;
  const server = spawnTracked(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, VITE_BETTER_EMAIL_UI_MOCK: '1', VITE_BETTER_EMAIL_SEED_MOCK_DATA: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', data => process.stderr.write(data));
  let serverReady = false;
  server.stdout.on('data', data => { if (String(data).includes(`127.0.0.1:${port}`)) serverReady = true; });
  for (let attempt = 0; ; attempt += 1) {
    if (server.exitCode !== null) throw new Error('Isolated Vite server exited');
    try { if (serverReady && (await fetch(url)).ok) break; } catch { /* retry server readiness */ }
    if (attempt > 100) throw new Error('Vite readiness timeout');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const config = { repeats, messageCount, engine: 'macOS WKWebView (isolated native shell)' };
  const probeFile = join(temp, 'probe.js');
  const rawResult = join(temp, 'result.json');
  writeFileSync(probeFile, `(() => {
    const pending = new Map(); let next = 0;
    const post = body => window.webkit.messageHandlers.performanceProbe.postMessage(body);
    window.__perfHostAction = action => new Promise(resolve => { const id = ++next; pending.set(id, resolve); post({type:'action', id, action}); });
    window.__perfResolve = id => { pending.get(id)?.(); pending.delete(id); };
    window.__perfHostLog = name => post({type:'progress', name});
    (${runInteractionPerformance.toString()})(${JSON.stringify(config)}).then(result => post({type:'result', result}), error => post({type:'error', error:String(error) + '\\n' + String(error.stack ?? '')}));
    return true;
  })()`);
  console.log(`[native-perf] Starting ${config.engine}; ${messageCount} mock messages, ${repeats} repeats`);
  await completion(spawnTracked(binary, [url, probeFile, rawResult]));
  const result = JSON.parse(readFileSync(rawResult, 'utf8'));
  result.host = { node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCPUs: cpus().length };
  result.recordedAt = new Date().toISOString();
  result.sourceHashes = Object.fromEntries(['src/hooks/useComposerGeometry.ts', 'src/components/ComposerWindow.tsx', 'scripts/ui-performance-probe.mjs'].map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
  writeFileSync(output, JSON.stringify(result, null, 2));
  if (existsSync(rawResult + '.png')) copyFileSync(rawResult + '.png', output + '.png');
  if (result.error) throw new Error(result.error);
  console.log(`[native-perf] Saved ${output}`);
  for (const scenario of result.scenarios) console.log(JSON.stringify({name: scenario.name, rafIntervals: { ...scenario.rafIntervals, rawMs: undefined }, selection: scenario.selectionToTitleAndRaf, input: scenario.inputCommandToNextRaf}));
} finally {
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  rmSync(temp, { recursive: true, force: true });
}
