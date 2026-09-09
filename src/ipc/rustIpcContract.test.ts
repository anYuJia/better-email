import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from './commands';

function registeredRustCommands(): Set<string> {
  const source = readFileSync(join(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8');
  const marker = '.invoke_handler(tauri::generate_handler![';
  const start = source.indexOf(marker);
  expect(start, 'src-tauri/src/lib.rs 必须注册 Tauri invoke handler').toBeGreaterThanOrEqual(0);
  const end = source.indexOf('])', start + marker.length);
  expect(end, 'Tauri generate_handler! 注册块必须完整').toBeGreaterThan(start);
  const block = source.slice(start + marker.length, end);
  return new Set(
    [...block.matchAll(/(?:commands::)?([a-z][a-z0-9_]*)\s*,/g)]
      .map((match) => match[1]),
  );
}

describe('frontend ↔ Rust IPC contract', () => {
  it('every frontend IPC command is registered in the native Tauri handler', () => {
    const registered = registeredRustCommands();
    const declared = Object.values(IPC);
    const missing = declared.filter((command) => !registered.has(command));
    expect(missing, `Rust generate_handler! 缺少命令：${missing.join(', ')}`).toEqual([]);
  });
});
