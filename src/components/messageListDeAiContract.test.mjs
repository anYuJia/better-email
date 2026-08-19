import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readCss(relative) {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

function readTs(relative) {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

/* Comment stripping keeps the contract focused on real rules, not prose. */
function rulesOnly(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const messageListCss = rulesOnly(readCss('src/styles/message-list.css'));
const darkModeCss = rulesOnly(readCss('src/styles/dark-mode.css'));
const layoutTs = readTs('src/components/messageListLayout.ts');
const threadTs = readTs('src/components/ThreadListView.tsx');

/* ----------------------------------------------------------------------- *
 * Helpers
 * ----------------------------------------------------------------------- */

/** Extract all rule blocks for a selector (content inside braces). */
function extractBlock(css, selector) {
  const blocks = [];
  // Escape regex special chars in the selector, then build pattern.
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`,
    'g',
  );
  let match;
  while ((match = pattern.exec(css)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/** Extract a numeric value from a CSS declaration string. */
function extractDecl(block, prop) {
  const m = block.match(new RegExp(`${prop}\\s*:\\s*([0-9]+)(?:px)?`));
  return m ? parseInt(m[1], 10) : null;
}

/** Extract the TS constant value. */
function extractTsConst(ts, name) {
  const m = ts.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(\\d+)`));
  return m ? parseInt(m[1], 10) : null;
}

/* ----------------------------------------------------------------------- *
 * Contract: message list is a continuous list, not a card feed
 * ----------------------------------------------------------------------- *
 *
 * The inbox is quiet desktop productivity: opaque planes, 1px dividers,
 * luminance hierarchy. These invariants are intentionally few and
 * long-lived:
 *
 *  1. Rows are flat lines, not rounded cards with gaps.
 *  2. No persistent glass / blur on workspace surfaces.
 *  3. No !important crutches.
 *  4. No hardcoded hex — everything flows through semantic tokens.
 *  5. Attachment is metadata, not a 999px pill.
 *  6. Date headers are quiet metadata, not dashboard section headings.
 *  7. CSS row heights match the TS virtualization constants (height chain).
 *  8. Thread list speaks the same quiet list language as mail rows.
 *  9. Avatar tones are muted neutral in light mode.
 * 10. Toolbar is an opaque bar, not a SaaS glass header.
 * ----------------------------------------------------------------------- */

describe('message list de-AI contract — canonical stylesheet hygiene', () => {
  it('message-list.css contains no !important declarations', () => {
    expect(messageListCss).not.toContain('!important');
  });

  it('message-list.css contains no hardcoded hex colours', () => {
    // Only var(--...) references are allowed; no #abc or #aabbcc.
    expect(messageListCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('message-list.css contains no rgb()/rgba() literals', () => {
    expect(messageListCss).not.toMatch(/rgba?\(/);
  });

  it('message-list.css has no leftover pass-section comments', () => {
    const raw = readCss('src/styles/message-list.css');
    expect(raw).not.toMatch(/pass\s*\d/i);
    expect(raw).not.toMatch(/20\d{2}.*pass/i);
  });
});

describe('message list de-AI contract — rows are flat lines, not cards', () => {
  it('message-card has border-radius: 0 (not a rounded card)', () => {
    const blocks = extractBlock(messageListCss, '.message-card');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/border-radius:\s*0/);
  });

  it('message-card has no floating box-shadow (only inset divider allowed)', () => {
    const blocks = extractBlock(messageListCss, '.message-card');
    expect(blocks.length).toBeGreaterThan(0);
    // The only shadow allowed on the base row is the inset 1px divider.
    expect(blocks[0]).not.toMatch(/box-shadow:\s*var\(--ui-shadow(?!-none)/);
    expect(blocks[0]).toMatch(/box-shadow:\s*inset 0 -1px 0 var\(--ui-border\)/);
  });

  it('message-list-item has no margin/padding gap between rows', () => {
    const blocks = extractBlock(messageListCss, '.message-list-item');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/padding:\s*0/);
    expect(blocks[0]).not.toMatch(/margin/);
  });

  it('message-card background is transparent by default (list surface shows through)', () => {
    const blocks = extractBlock(messageListCss, '.message-card');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/background:\s*transparent/);
  });
});

describe('message list de-AI contract — no persistent glass', () => {
  it('message-list-panel has no backdrop-filter blur', () => {
    const blocks = extractBlock(messageListCss, '.message-list-panel');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/backdrop-filter:\s*none/);
    expect(blocks[0]).not.toMatch(/blur\(/);
  });

  it('toolbar has no backdrop-filter blur', () => {
    const blocks = extractBlock(messageListCss, '.toolbar');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/backdrop-filter:\s*none/);
    expect(blocks[0]).not.toMatch(/blur\(/);
  });

  it('date header has no backdrop-filter blur', () => {
    const blocks = extractBlock(messageListCss, '.message-date-header');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/backdrop-filter:\s*none/);
    expect(blocks[0]).not.toMatch(/blur\(/);
  });
});

describe('message list de-AI contract — attachment is metadata, not a pill', () => {
  it('message-attachment has no 999px pill radius', () => {
    const blocks = extractBlock(messageListCss, '.message-attachment');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).not.toMatch(/999px/);
    expect(blocks[0]).toMatch(/border-radius:\s*0/);
  });

  it('message-attachment has no border or background (just icon + text)', () => {
    const blocks = extractBlock(messageListCss, '.message-attachment');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/border:\s*0/);
    expect(blocks[0]).toMatch(/background:\s*transparent/);
  });
});

describe('message list de-AI contract — date headers are quiet metadata', () => {
  it('date header has no text-transform: uppercase', () => {
    const blocks = extractBlock(messageListCss, '.message-date-header');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/text-transform:\s*none/);
    expect(blocks[0]).not.toMatch(/uppercase/);
  });

  it('date header has no exaggerated letter-spacing', () => {
    const blocks = extractBlock(messageListCss, '.message-date-header');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/letter-spacing:\s*0/);
    // No letter-spacing value > 0.01em
    const lsMatch = blocks[0].match(/letter-spacing:\s*([0-9.]+)em/);
    if (lsMatch) {
      expect(parseFloat(lsMatch[1])).toBeLessThanOrEqual(0.01);
    }
  });

  it('date header font-size is small (<= 12px) and weight is medium (<= 600)', () => {
    const blocks = extractBlock(messageListCss, '.message-date-header');
    expect(blocks.length).toBeGreaterThan(0);
    const fs = extractDecl(blocks[0], 'font-size');
    const fw = extractDecl(blocks[0], 'font-weight');
    expect(fs).not.toBeNull();
    expect(fs).toBeLessThanOrEqual(12);
    expect(fw).not.toBeNull();
    expect(fw).toBeLessThanOrEqual(600);
  });
});

describe('message list de-AI contract — CSS/TS row-height chain', () => {
  it('message-list-item CSS height === MESSAGE_ROW_HEIGHT TS constant', () => {
    const cssBlocks = extractBlock(messageListCss, '.message-list-item');
    expect(cssBlocks.length).toBeGreaterThan(0);
    const cssHeight = extractDecl(cssBlocks[0], 'height');
    const tsHeight = extractTsConst(layoutTs, 'MESSAGE_ROW_HEIGHT');
    expect(cssHeight).not.toBeNull();
    expect(tsHeight).not.toBeNull();
    expect(cssHeight).toBe(tsHeight);
    expect(cssHeight).toBe(64);
  });

  it('message-date-header CSS height === GROUP_HEADER_HEIGHT TS constant', () => {
    const cssBlocks = extractBlock(messageListCss, '.message-date-header');
    expect(cssBlocks.length).toBeGreaterThan(0);
    const cssHeight = extractDecl(cssBlocks[0], 'height');
    const tsHeight = extractTsConst(layoutTs, 'GROUP_HEADER_HEIGHT');
    expect(cssHeight).not.toBeNull();
    expect(tsHeight).not.toBeNull();
    expect(cssHeight).toBe(tsHeight);
    expect(cssHeight).toBe(30);
  });

  it('thread-card CSS height === THREAD_ROW_HEIGHT TS constant', () => {
    const cssBlocks = extractBlock(messageListCss, '.thread-card');
    expect(cssBlocks.length).toBeGreaterThan(0);
    const cssHeight = extractDecl(cssBlocks[0], 'height');
    const tsHeight = extractTsConst(threadTs, 'THREAD_ROW_HEIGHT');
    expect(cssHeight).not.toBeNull();
    expect(tsHeight).not.toBeNull();
    expect(cssHeight).toBe(tsHeight);
    expect(cssHeight).toBe(72);
  });

  it('LIST_FOOTER_HEIGHT TS constant matches message-list-footer CSS height', () => {
    const cssBlocks = extractBlock(messageListCss, '.message-list-footer');
    expect(cssBlocks.length).toBeGreaterThan(0);
    const cssHeight = extractDecl(cssBlocks[0], 'height');
    const tsHeight = extractTsConst(layoutTs, 'LIST_FOOTER_HEIGHT');
    expect(cssHeight).not.toBeNull();
    expect(tsHeight).not.toBeNull();
    expect(cssHeight).toBe(tsHeight);
  });
});

describe('message list de-AI contract — thread list speaks the same language', () => {
  it('thread-card has border-radius: 0 (not a rounded card)', () => {
    const blocks = extractBlock(messageListCss, '.thread-card');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/border-radius:\s*0/);
  });

  it('thread-card has no floating box-shadow (only inset divider)', () => {
    const blocks = extractBlock(messageListCss, '.thread-card');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/box-shadow:\s*inset 0 -1px 0 var\(--ui-border\)/);
    expect(blocks[0]).not.toMatch(/box-shadow:\s*var\(--ui-shadow(?!-none)/);
  });

  it('thread-card background is transparent by default', () => {
    const blocks = extractBlock(messageListCss, '.thread-card');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/background:\s*transparent/);
  });

  it('thread-card has no !important', () => {
    const threadSection = messageListCss.slice(
      messageListCss.indexOf('.thread-list'),
    );
    expect(threadSection).not.toContain('!important');
  });
});

describe('message list de-AI contract — avatar tones are muted neutral', () => {
  it('avatar-tone classes use semantic tokens, not hardcoded hex', () => {
    for (let i = 0; i <= 5; i++) {
      const blocks = extractBlock(messageListCss, `.avatar-tone-${i}`);
      expect(blocks.length, `.avatar-tone-${i} must exist`).toBeGreaterThan(0);
      expect(blocks[0], `.avatar-tone-${i} must use var() for color`).toMatch(
        /color:\s*var\(/,
      );
      expect(blocks[0], `.avatar-tone-${i} must use var() for background`).toMatch(
        /background:\s*var\(/,
      );
      expect(blocks[0], `.avatar-tone-${i} must not contain hex`).not.toMatch(
        /#[0-9a-fA-F]{3,8}/,
      );
    }
  });
});

describe('message list de-AI contract — dark mode reconciliation', () => {
  it('dark-mode.css message-list / thread sections have no !important', () => {
    // Check only the specific message-list and thread selectors, not
    // the entire dark-mode.css (composer/reader have their own !important).
    const selectors = [
      '.message-list-footer',
      '.bulk-toolbar',
      '.message-chips span',
      '.message-attachment',
      '.message-avatar',
      '.reader-avatar',
      '.thread-unread-dot',
      '.avatar-tone-0',
      '.avatar-tone-1',
      '.avatar-tone-2',
      '.avatar-tone-3',
      '.avatar-tone-4',
      '.avatar-tone-5',
    ];

    for (const sel of selectors) {
      const blocks = extractBlock(darkModeCss, sel);
      for (const block of blocks) {
        expect(block, `${sel} in dark-mode.css must not use !important`).not.toContain('!important');
      }
    }
  });

  it('dark-mode.css has no backdrop-filter blur on message list surfaces', () => {
    // Remove window-chrome section (platform chrome exception)
    const nonChrome = darkModeCss.replace(/\.window-chrome[\s\S]*?\}/g, '');
    expect(nonChrome).not.toMatch(/backdrop-filter:\s*blur\(/);
  });
});

describe('message list de-AI contract — selection states are distinguishable', () => {
  it('hover state uses --quiet-row-hover (subtle neutral)', () => {
    expect(messageListCss).toMatch(
      /\.message-card:hover[\s\S]*?background:\s*var\(--quiet-row-hover\)/,
    );
  });

  it('current / selected state uses --quiet-row-selected (soft selection)', () => {
    expect(messageListCss).toMatch(
      /\.message-card\.is-current[\s\S]*?background:\s*var\(--quiet-row-selected\)/,
    );
    expect(messageListCss).toMatch(
      /\.message-card\.selected[\s\S]*?background:\s*var\(--quiet-row-selected\)/,
    );
  });

  it('unread rows share the same surface as read rows (no separate card bg)', () => {
    const blocks = extractBlock(messageListCss, '.message-card.is-unread');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/background:\s*transparent/);
  });

  it('unread emphasis is font-weight only (sender + subject)', () => {
    const senderUnread = extractBlock(messageListCss, '.sender.unread');
    expect(senderUnread.length).toBeGreaterThan(0);
    expect(senderUnread[0]).toMatch(/font-weight:\s*600/);

    const subjectUnread = extractBlock(messageListCss, '.subject.unread');
    expect(subjectUnread.length).toBeGreaterThan(0);
    expect(subjectUnread[0]).toMatch(/font-weight:\s*600/);
  });
});

describe('message list de-AI contract — toolbar is a tool bar, not a SaaS header', () => {
  it('toolbar uses opaque --ui-list surface, not glass', () => {
    const blocks = extractBlock(messageListCss, '.toolbar');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(/background:\s*var\(--ui-list\)/);
  });

  it('search-box height is 32-34px with small radius', () => {
    const blocks = extractBlock(messageListCss, '.search-box');
    expect(blocks.length).toBeGreaterThan(0);
    const h = extractDecl(blocks[0], 'height');
    const r = extractDecl(blocks[0], 'border-radius');
    expect(h).not.toBeNull();
    expect(h).toBeGreaterThanOrEqual(32);
    expect(h).toBeLessThanOrEqual(34);
    expect(r).not.toBeNull();
    expect(r).toBeGreaterThanOrEqual(6);
    expect(r).toBeLessThanOrEqual(8);
  });

  it('refresh button is icon-first (not a primary gradient CTA)', () => {
    const blocks = extractBlock(messageListCss, '.refresh-text-button');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).not.toMatch(/gradient/);
    expect(blocks[0]).not.toMatch(/999px/);
  });
});
