import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(repoRoot, 'src/tauriBridge.ts'), 'utf8');

describe('Tauri bridge production/mock boundary', () => {
  it('never enables mock mode merely because the native runtime is missing', () => {
    expect(source).not.toMatch(/\|\|\s*!hasTauriRuntime/);
    expect(source).toContain("VITE_BETTER_EMAIL_UI_MOCK === '1'");
    expect(source).toContain('Better Email native runtime unavailable');
  });

  it('does not keep the legacy SwiftMail mock environment switch', () => {
    expect(source).not.toContain('VITE_SWIFTMAIL_UI_MOCK');
  });
});
