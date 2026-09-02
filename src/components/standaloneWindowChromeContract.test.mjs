import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bridge = readFileSync(join(root, 'src/tauriBridge.prod.ts'), 'utf8');
const appRoot = readFileSync(join(root, 'src/app/AppRoot.tsx'), 'utf8');
const chrome = readFileSync(join(root, 'src/components/DesktopWindowChrome.tsx'), 'utf8');

describe('standalone desktop window chrome', () => {
  it('uses overlay native titlebars for composer and settings', () => {
    expect(bridge).not.toMatch(/titleBarStyle:\s*'visible'/);
    expect(bridge.match(/titleBarStyle:\s*'overlay'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(bridge.match(/hiddenTitle:\s*true/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('wraps both standalone surfaces with shared chrome', () => {
    expect(appRoot).toContain('StandaloneWindowFrame kind="composer"');
    expect(appRoot).toContain('StandaloneWindowFrame kind="settings"');
  });

  it('removes decorations from the current Windows child window', () => {
    expect(chrome).toContain("resolved === 'windows'");
    expect(chrome).toContain('setDecorations(false)');
  });
});
