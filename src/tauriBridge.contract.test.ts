import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src/tauriBridge.ts'), 'utf8');

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
