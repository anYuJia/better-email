import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mobileReaderCss = readFileSync(join(repoRoot, 'src/styles/mobile-reader.css'), 'utf8');
const mobileCss = readFileSync(join(repoRoot, 'src/styles/mobile.css'), 'utf8');

function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('mobile reader scroll contract', () => {
  it('constrains the reader destination as a flex column', () => {
    const body = ruleBody(mobileReaderCss, '.mobile-reader-surface');
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/overflow:\s*hidden/);
  });

  it('keeps reader-panel as the vertical touch scroll owner', () => {
    expect(mobileCss).toMatch(/\.mobile-reader-surface\s*>\s*\.reader-panel\s*\{[\s\S]*?overflow:\s*auto/);
    expect(mobileCss).toMatch(/\.mobile-reader-surface\s*>\s*\.reader-panel\s*\{[\s\S]*?touch-action:\s*pan-y/);
  });
});
