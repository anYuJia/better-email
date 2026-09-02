import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bridge = readFileSync(join(root, 'src/tauriBridge.prod.ts'), 'utf8');
const composer = readFileSync(join(root, 'src/components/StandaloneComposerApp.tsx'), 'utf8');
const settings = readFileSync(join(root, 'src/components/settings/SettingsFrame.tsx'), 'utf8');

describe('standalone desktop window chrome', () => {
  it('uses overlay titlebars for composer and settings windows', () => {
    expect(bridge).not.toMatch(/titleBarStyle:\s*'visible'/);
    expect(bridge.match(/titleBarStyle:\s*'overlay'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('renders shared chrome in composer and settings', () => {
    expect(composer).toContain('StandaloneWindowChrome');
    expect(settings).toContain('StandaloneWindowChrome');
  });
});
