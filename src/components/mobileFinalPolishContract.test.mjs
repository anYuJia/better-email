import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(join(repoRoot, relative), 'utf8');
const entryCss = read('src/ui-2026.css');
const finalCss = read('src/styles/deai-final-polish.css');
const inboxHeader = read('src/components/mobile/MobileInboxHeader.tsx');
const layoutTs = read('src/components/messageListLayout.ts');

describe('final mobile polish contract', () => {
  it('loads the final polish after the first product pass', () => {
    const firstPass = entryCss.indexOf("@import './styles/deai-product-polish.css';");
    const finalPass = entryCss.indexOf("@import './styles/deai-final-polish.css';");
    expect(firstPass).toBeGreaterThanOrEqual(0);
    expect(finalPass).toBeGreaterThan(firstPass);
  });

  it('uses one filter utility instead of a persistent mobile filter tab row', () => {
    expect(inboxHeader).not.toContain('mobile-inbox-filter-row');
    expect(inboxHeader).toContain('mobile-filter-trigger');
    expect(inboxHeader).toContain('filterMenuItems');
  });

  it('keeps the mobile mail list dense without shrinking below a large touch row', () => {
    expect(layoutTs).toMatch(/MOBILE_MESSAGE_ROW_HEIGHT\s*=\s*80/);
    expect(finalCss).toMatch(/\.mobile-message-list-panel \.message-leading\s*\{[\s\S]*?display:\s*none;/);
  });

  it('reduces reader, settings and composer feature-showcase chrome', () => {
    expect(finalCss).toMatch(/\.reader-actions :is\(button, summary\) > span\s*\{[\s\S]*?clip-path:\s*inset\(50%\)/);
    expect(finalCss).toMatch(/\.mobile-settings-row-icon\s*\{[\s\S]*?display:\s*none;/);
    expect(finalCss).toContain('button[aria-label="收起写信"]');
    expect(finalCss).not.toContain('linear-gradient');
    expect(finalCss).not.toContain('backdrop-filter');
  });
});
