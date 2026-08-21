import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const checks = [
  {
    label: '前端 AI/MCP、mock 边界与 IPC 契约',
    command: npx,
    args: [
      'vitest',
      'run',
      'src/app/aiService.test.ts',
      'src/components/settings/AiServiceSettings.test.tsx',
      'src/mockTauri/aiHandlers.test.ts',
      'src/mockTauri/miscHandlers.test.ts',
      'src/ipc/ipcContract.test.ts',
    ],
  },
  {
    label: 'Rust MCP/AI HTTP 协议与安全边界',
    command: 'cargo',
    args: ['test', '--manifest-path', 'src-tauri/Cargo.toml', 'ai::tests'],
  },
];

for (const check of checks) {
  console.log(`[test:services] START ${check.label}`);
  const result = spawnSync(check.command, check.args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`[test:services] ${check.label} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[test:services] FAIL ${check.label}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[test:services] DONE ${check.label}`);
}

console.log('[test:services] all service checks passed');
