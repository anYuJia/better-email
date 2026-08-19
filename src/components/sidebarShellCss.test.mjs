import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readCss(relative) {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

/* Comment stripping keeps the contract focused on real rules, not prose. */
function rulesOnly(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const layoutCss = rulesOnly(readCss('src/styles/layout.css'));
const sidebarCss = rulesOnly(readCss('src/styles/sidebar.css'));
const darkModeCss = rulesOnly(readCss('src/styles/dark-mode.css'));
const windowChromeCss = rulesOnly(readCss('src/styles/window-chrome.css'));
const accountSwitcherCss = rulesOnly(readCss('src/components/account-switcher.css'));

/**
 * App-shell / sidebar design contract (de-AI guard):
 *
 * The workspace is quiet desktop productivity — opaque planes, 1px dividers,
 * luminance hierarchy. These invariants are intentionally few and long-lived:
 *
 * 1. No persistent glass: the workspace panes never carry backdrop-filter;
 *    only the native window chrome strip may blur (platform chrome exception).
 * 2. layout.css owns shell geometry only — no sidebar component styling.
 * 3. No gradient, no 999px pill, no floating shadow on sidebar controls.
 * 4. Selected / hover states must stay distinguishable without heavy chrome.
 * 5. The pane-divider visual stays a 1px line with a larger hit target.
 */
describe('app shell de-AI contract', () => {
  it('layout.css keeps persistent panes free of backdrop-filter', () => {
    expect(layoutCss).not.toMatch(/backdrop-filter/);
    expect(layoutCss).not.toMatch(/blur\(/);
  });

  it('layout.css owns shell geometry only — no sidebar component styling', () => {
    expect(layoutCss).not.toMatch(/(^|})\s*\.sidebar\s*\{/);
    expect(layoutCss).not.toMatch(/(^|})\s*\.brand\s*\{/);
    expect(layoutCss).not.toMatch(/(^|})\s*\.compose-button\s*\{/);
    expect(layoutCss).not.toMatch(/(^|})\s*\.settings-button\s*\{/);
  });

  it('app-shell pane surfaces are opaque planes, not floating glass', () => {
    expect(layoutCss).not.toMatch(/-webkit-backdrop-filter/);
    expect(layoutCss).not.toMatch(/rgba\(/);
    expect(layoutCss).not.toMatch(/box-shadow:\s*var\(--ui-shadow/);
  });

  it('keeps the pane divider as a 1px line with a wider hit target', () => {
    expect(layoutCss).toMatch(/\.app-shell \.pane-resizer::before\s*\{[^}]*width:\s*1px/);
    expect(layoutCss).toMatch(/\.app-shell \.pane-resizer::after\s*\{[^}]*inset:\s*0 -4px/);
    expect(layoutCss).toMatch(/\.app-shell \.pane-resizer\s*\{[^}]*cursor:\s*col-resize/);
  });
});

describe('sidebar de-AI contract', () => {
  it('compose button has no gradient and no pill radius', () => {
    const block = sidebarCss.match(/\.compose-button\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).not.toMatch(/gradient/);
    expect(block[1]).not.toMatch(/999px/);
  });

  it('folder rows stay flat: no pill radius, no floating shadow, no scale', () => {
    expect(sidebarCss).not.toMatch(/\.folder\s*\{[^}]*999px/);
    expect(sidebarCss).not.toMatch(/\.folder\s*\{[^}]*box-shadow:\s*var\(--ui-shadow/);
    expect(sidebarCss).not.toMatch(/transform:\s*scale\(/);
  });

  it('settings rows use the same flat language', () => {
    expect(sidebarCss).not.toMatch(/\.settings-button\s*\{[^}]*999px/);
    expect(sidebarCss).not.toMatch(/\.settings-button\s*\{[^}]*gradient/);
  });

  it('account switcher trigger is a flat row, not a raised card', () => {
    const block = accountSwitcherCss.match(/\.account-switcher-trigger\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).not.toMatch(/999px/);
    expect(block[1]).not.toMatch(/gradient/);
    expect(block[1]).not.toMatch(/box-shadow:\s*var\(--ui-shadow/);
  });

  it('selected state stays distinguishable via surface + text weight', () => {
    expect(sidebarCss).toMatch(/\.folder\.active[\s\S]*?background:\s*var\(--quiet-row-selected\)/);
    expect(sidebarCss).toMatch(/\.folder\.active \.folder-main\s*\{[^}]*font-weight:\s*600/);
  });

  it('keeps keyboard focus visible on interactive rows', () => {
    expect(sidebarCss).toMatch(/\.folder-main:focus-visible\s*\{[^}]*outline:/);
    expect(sidebarCss).toMatch(/\.settings-button:focus-visible\s*\{[^}]*outline:/);
    expect(sidebarCss).toMatch(/\.compose-button:focus-visible\s*\{[^}]*outline:/);
    expect(accountSwitcherCss).toMatch(/\.account-switcher-trigger:focus-visible\s*\{[^}]*outline:/);
  });

  it('sidebar motion animates colour only, at fast speed', () => {
    expect(sidebarCss).not.toMatch(/transform:\s*scale\(/);
    expect(sidebarCss).toMatch(/transition:\s*var\(--ui-transition-fast-color-background\)/);
  });

  it('reduced-motion kill switch remains for rows', () => {
    expect(sidebarCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(sidebarCss).toMatch(/transition:\s*var\(--ui-transition-none\)/);
  });
});

describe('dark mode sidebar contract', () => {
  it('dark workspace removes persistent glass too', () => {
    // The only allowed blur in dark-mode.css is the window chrome strip;
    // `backdrop-filter: none` declarations (glass removal) are fine.
    const nonChrome = darkModeCss.replace(/\.window-chrome[\s\S]*?\}/g, '');
    expect(nonChrome).not.toMatch(/backdrop-filter:\s*blur\(/);
    expect(nonChrome).not.toMatch(/blur\(/);
  });

  it('dark sidebar surfaces stay on the semantic neutral scale', () => {
    expect(darkModeCss).not.toMatch(/\.sidebar\s*\{[^}]*gradient/);
    expect(darkModeCss).not.toMatch(/\.sidebar\s*\{[^}]*linear-gradient/);
    expect(darkModeCss).not.toMatch(/\.sidebar\s*\{[^}]*box-shadow:\s*var\(--ui-shadow/);
  });
});

describe('window chrome contract', () => {
  it('the only persistent backdrop-filter is the native chrome strip', () => {
    // Window chrome is platform chrome, not workspace glass.
    expect(windowChromeCss).toMatch(/\.window-chrome/);
    expect(layoutCss).not.toMatch(/backdrop-filter:\s*blur\(/);
    expect(darkModeCss.replace(/\.window-chrome[\s\S]*?\}/g, '')).not.toMatch(/backdrop-filter:\s*blur\(/);
  });
});
