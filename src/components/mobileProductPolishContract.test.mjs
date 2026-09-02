import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(join(repoRoot, relative), 'utf8');
const entryCss = read('src/ui-2026.css');
const polishCss = read('src/styles/deai-product-polish.css');

describe('mobile product de-AI contract', () => {
  it('loads product polish after theme and compatibility layers', () => {
    const themeIndex = entryCss.indexOf("@import './styles/dark-mode.css';");
    const compatibilityIndex = entryCss.indexOf("@import './components/notifications.css';");
    const polishIndex = entryCss.indexOf("@import './styles/deai-product-polish.css';");

    expect(themeIndex).toBeGreaterThanOrEqual(0);
    expect(compatibilityIndex).toBeGreaterThan(themeIndex);
    expect(polishIndex).toBeGreaterThan(compatibilityIndex);
  });

  it('collapses the mixed bottom navigation to a single compose affordance', () => {
    expect(polishCss).toContain('.mobile-bottom-nav > button');
    expect(polishCss).toContain('display: none;');
    expect(polishCss).toContain('.mobile-bottom-nav > .mobile-bottom-compose');
    expect(polishCss).toContain('position: fixed;');
  });

  it('keeps persistent mobile navigation and settings surfaces flat', () => {
    expect(polishCss).toMatch(/\.mobile-mailbox-list\s*\{[\s\S]*?border:\s*0;[\s\S]*?box-shadow:\s*none;/);
    expect(polishCss).toMatch(/\.mobile-settings-account-summary\s*\{[\s\S]*?border-radius:\s*0;[\s\S]*?box-shadow:\s*none;/);
    expect(polishCss).toMatch(/\.mobile-settings-row-icon\s*\{[\s\S]*?background:\s*transparent;/);
  });

  it('keeps the reader and composer full-screen instead of card-like', () => {
    expect(polishCss).toContain('.app-shell.is-mobile-app .reader');
    expect(polishCss).toContain('.app-shell.is-mobile-app .composer');
    expect(polishCss).toMatch(/\.composer-rich-toolbar\s*\{[\s\S]*?border-radius:\s*0;/);
    expect(polishCss).not.toContain('backdrop-filter');
    expect(polishCss).not.toContain('linear-gradient');
  });

  it('removes repeated product identity and mailbox context from desktop chrome', () => {
    expect(polishCss).toMatch(/\.app-titlebar \.titlebar-brand,[\s\S]*?\.app-titlebar \.titlebar-context\s*\{[\s\S]*?display:\s*none;/);
  });
});
