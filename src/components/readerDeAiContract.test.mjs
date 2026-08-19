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

const readerCss = rulesOnly(readCss('src/styles/reader.css'));
const darkModeCss = rulesOnly(readCss('src/styles/dark-mode.css'));
const emailShadowTs = readTs('src/components/reader/EmailShadowView.tsx');
const plainMessageTs = readTs('src/components/reader/PlainMessageBody.tsx');
const readerLabelMenuTs = readTs('src/components/reader/ReaderLabelMenu.tsx');

/* ----------------------------------------------------------------------- *
 * Helpers
 * ----------------------------------------------------------------------- */

/**
 * Split CSS into individual rule blocks (selector + declaration block).
 * Each entry is { selector, body }.
 * This handles multi-selector rules by expanding them.
 */
function parseRules(css) {
  const rules = [];
  // Match selector(s) { body } — handles nested braces minimally
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    const selectorGroup = match[1].trim();
    const body = match[2];
    // Expand comma-separated selectors
    for (const sel of selectorGroup.split(',')) {
      rules.push({ selector: sel.trim(), body });
    }
  }
  return rules;
}

/** Find all rule blocks matching a selector substring. */
function findRules(css, selectorSubstr) {
  return parseRules(css).filter((r) =>
    r.selector.includes(selectorSubstr),
  );
}

/** Extract a numeric value from a CSS declaration string. */
function extractDecl(block, prop) {
  const m = block.match(new RegExp(`${prop}\\s*:\\s*([0-9]+)(?:px)?`));
  return m ? parseInt(m[1], 10) : null;
}

/** Get the "core" reader CSS (excluding the image preview overlay section). */
function getCoreReaderCss() {
  const overlayStart = readerCss.indexOf('reader-image-preview-backdrop');
  return overlayStart > 0 ? readerCss.slice(0, overlayStart) : readerCss;
}

/* ----------------------------------------------------------------------- *
 * Contract: the reader is a quiet reading workspace, not a designed card.
 *
 * The email reader is desktop productivity: a full-height opaque pane,
 * readable typography, compact metadata. These invariants are intentionally
 * few and long-lived:
 *
 *  1. Reader is an opaque pane, not a floating card with shadow.
 *  2. No persistent glass / blur on reader workspace surfaces.
 *  3. No !important crutches.
 *  4. No hardcoded hex in core reader regions (overlay is exempt).
 *  5. Subject is a heading, not a hero (18-20px, 600, not 28+ / 800).
 *  6. Body typography is for reading (14-15px, line-height 1.55-1.65).
 *  7. Attachments are compact rows, not big cards.
 *  8. Quick reply is a quiet inline entry, not a large input card.
 *  9. Translation panel is a utility note, not an AI magic card.
 * 10. Toolbar is icon-first controls, not a glass/gradient bar.
 * 11. Delete is neutral by default, danger on hover only.
 * 12. Avatar tones are muted neutral, same system as inbox.
 * 13. No pass-section comments left from historical refactoring.
 * 14. Dark mode reader overrides use semantic tokens, not hex/rgba.
 * 15. Shadow DOM email styles use inherited semantic tokens, not hex.
 * 16. Inline styles in TSX use semantic tokens, not hardcoded hex.
 * ----------------------------------------------------------------------- */

describe('reader de-AI contract — canonical stylesheet hygiene', () => {
  it('reader.css contains no !important declarations', () => {
    expect(readerCss).not.toContain('!important');
  });

  it('core reader.css has no hardcoded hex colours (overlay exempt)', () => {
    // The image preview overlay is a transient dialog (fixed, dark, blurred).
    // It may use hex/rgba for its own visual surface. The core reader
    // workspace (shell, toolbar, body, attachments, quick-reply, translation,
    // thread) must not contain hardcoded hex.
    const coreCss = getCoreReaderCss();
    expect(coreCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('core reader.css has no rgb()/rgba() literals (overlay exempt)', () => {
    const coreCss = getCoreReaderCss();
    expect(coreCss).not.toMatch(/rgba?\(/);
  });

  it('reader.css has no leftover pass-section comments', () => {
    const raw = readCss('src/styles/reader.css');
    expect(raw).not.toMatch(/pass\s*\d/i);
    expect(raw).not.toMatch(/20\d{2}.*pass/i);
  });

  it('core reader.css has no gradient declarations (overlay exempt)', () => {
    const coreCss = getCoreReaderCss();
    expect(coreCss).not.toMatch(/gradient/);
  });
});

describe('reader de-AI contract — reader is an opaque pane, not a floating card', () => {
  it('reader-panel has no floating box-shadow', () => {
    const rules = findRules(readerCss, '.reader-panel');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).not.toMatch(/box-shadow:\s*var\(--ui-shadow(?!-none)/);
    }
  });

  it('reader-panel has no backdrop-filter blur', () => {
    const rules = findRules(readerCss, '.reader-panel');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).not.toMatch(/backdrop-filter:\s*blur/);
    }
  });

  it('body-text has box-shadow: none (not a floating card)', () => {
    const rules = findRules(readerCss, '.body-text');
    expect(rules.length).toBeGreaterThan(0);
    const hasNone = rules.some((r) =>
      r.body.match(/box-shadow:\s*var\(--ui-box-shadow-none\)/),
    );
    expect(hasNone).toBe(true);
  });

  it('body-text has transparent background', () => {
    const rules = findRules(readerCss, '.body-text');
    expect(rules.length).toBeGreaterThan(0);
    const hasTransparent = rules.some((r) =>
      r.body.match(/background:\s*transparent/),
    );
    expect(hasTransparent).toBe(true);
  });
});

describe('reader de-AI contract — subject is a heading, not a hero', () => {
  it('subject h1 font-size is 18-20px (not hero-sized)', () => {
    const rules = findRules(readerCss, '.reader-header h1');
    expect(rules.length).toBeGreaterThan(0);
    const fs = extractDecl(rules[0].body, 'font-size');
    expect(fs).not.toBeNull();
    expect(fs).toBeGreaterThanOrEqual(18);
    expect(fs).toBeLessThanOrEqual(20);
  });

  it('subject h1 font-weight is <= 600 (not 700-800)', () => {
    const rules = findRules(readerCss, '.reader-header h1');
    expect(rules.length).toBeGreaterThan(0);
    const m = rules[0].body.match(/font-weight:\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(parseInt(m[1], 10)).toBeLessThanOrEqual(600);
  });

  it('subject h1 line-height is <= 1.4 (not loose hero spacing)', () => {
    const rules = findRules(readerCss, '.reader-header h1');
    expect(rules.length).toBeGreaterThan(0);
    const m = rules[0].body.match(/line-height:\s*([0-9.]+)/);
    expect(m).not.toBeNull();
    expect(parseFloat(m[1])).toBeLessThanOrEqual(1.4);
  });
});

describe('reader de-AI contract — body typography is for reading', () => {
  it('app-shell body-text font-size is 14-15px', () => {
    const rules = findRules(readerCss, '.app-shell .body-text');
    expect(rules.length).toBeGreaterThan(0);
    const fs = extractDecl(rules[0].body, 'font-size');
    expect(fs).not.toBeNull();
    expect(fs).toBeGreaterThanOrEqual(14);
    expect(fs).toBeLessThanOrEqual(15);
  });

  it('app-shell body-text line-height is 1.55-1.65', () => {
    const rules = findRules(readerCss, '.app-shell .body-text');
    expect(rules.length).toBeGreaterThan(0);
    const m = rules[0].body.match(/line-height:\s*([0-9.]+)/);
    expect(m).not.toBeNull();
    expect(parseFloat(m[1])).toBeGreaterThanOrEqual(1.55);
    expect(parseFloat(m[1])).toBeLessThanOrEqual(1.65);
  });
});

describe('reader de-AI contract — attachments are compact rows, not big cards', () => {
  it('attachment-item min-height is <= 48px', () => {
    const rules = findRules(readerCss, '.attachments .attachment-item');
    expect(rules.length).toBeGreaterThan(0);
    const h = extractDecl(rules[0].body, 'min-height');
    expect(h).not.toBeNull();
    expect(h).toBeLessThanOrEqual(48);
  });

  it('attachment-item has no floating box-shadow', () => {
    const rules = findRules(readerCss, '.attachments .attachment-item');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).not.toMatch(/box-shadow:\s*var\(--ui-shadow(?!-none)/);
    }
  });

  it('attachment-file-icon has no gradient', () => {
    const rules = findRules(readerCss, '.attachment-file-icon');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).not.toMatch(/gradient/);
    }
  });
});

describe('reader de-AI contract — quick reply is a quiet inline entry', () => {
  it('quick-reply has box-shadow: none', () => {
    const rules = findRules(readerCss, '.quick-reply');
    expect(rules.length).toBeGreaterThan(0);
    const hasNone = rules.some((r) =>
      r.body.match(/box-shadow:\s*var\(--ui-box-shadow-none\)/),
    );
    expect(hasNone).toBe(true);
  });

  it('quick-reply has transparent background', () => {
    const rules = findRules(readerCss, '.quick-reply');
    expect(rules.length).toBeGreaterThan(0);
    const hasTransparent = rules.some((r) =>
      r.body.match(/background:\s*transparent/),
    );
    expect(hasTransparent).toBe(true);
  });

  it('quick-reply has border-top, not a full border card', () => {
    const rules = findRules(readerCss, '.quick-reply');
    expect(rules.length).toBeGreaterThan(0);
    const hasBorderTop = rules.some((r) =>
      r.body.match(/border-top:\s*1px/),
    );
    expect(hasBorderTop).toBe(true);
  });
});

describe('reader de-AI contract — translation panel is a utility note, not AI magic', () => {
  it('translation banner has no gradient', () => {
    const rules = findRules(readerCss, '.reader-translation-banner');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).not.toMatch(/gradient/);
    }
  });

  it('translation banner has no purple/sparkle glow', () => {
    const rules = findRules(readerCss, '.reader-translation-banner');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).not.toMatch(/purple/);
      expect(r.body).not.toMatch(/sparkle/);
      expect(r.body).not.toMatch(/glow/);
    }
  });

  it('translation content uses neutral surface-muted, not accent-tinted', () => {
    const rules = findRules(readerCss, '.reader-translation-content');
    expect(rules.length).toBeGreaterThan(0);
    const hasMuted = rules.some((r) =>
      r.body.match(/background:\s*var\(--ui-surface-muted\)/),
    );
    expect(hasMuted).toBe(true);
  });

  it('translation header uses neutral text, not coloured accent', () => {
    const rules = findRules(readerCss, '.reader-translation-header');
    expect(rules.length).toBeGreaterThan(0);
    const hasNeutral = rules.some((r) =>
      r.body.match(/color:\s*var\(--ui-text/),
    );
    expect(hasNeutral).toBe(true);
  });
});

describe('reader de-AI contract — toolbar is icon-first controls, not a glass bar', () => {
  it('reader-actions has no backdrop-filter blur', () => {
    const rules = findRules(readerCss, '.reader-actions');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).not.toMatch(/backdrop-filter:\s*blur/);
    }
  });

  it('reader-actions has transparent background (not glass)', () => {
    const rules = findRules(readerCss, '.reader-actions');
    expect(rules.length).toBeGreaterThan(0);
    const hasTransparent = rules.some((r) =>
      r.body.match(/background:\s*transparent/),
    );
    expect(hasTransparent).toBe(true);
  });

  it('reader-actions has box-shadow: none', () => {
    const rules = findRules(readerCss, '.reader-actions');
    expect(rules.length).toBeGreaterThan(0);
    const hasNone = rules.some((r) =>
      r.body.match(/box-shadow:\s*var\(--ui-box-shadow-none\)/),
    );
    expect(hasNone).toBe(true);
  });

  it('reader-actions buttons are 28-34px height', () => {
    const rules = findRules(readerCss, '.reader-actions button,');
    // Also check .reader-actions .reader-more-menu summary, .reader-actions select
    const allRules = findRules(readerCss, '.reader-actions');
    const buttonRules = allRules.filter((r) =>
      r.selector.includes('button') || r.selector.includes('summary') || r.selector.includes('select'),
    );
    expect(buttonRules.length).toBeGreaterThan(0);
    const h = extractDecl(buttonRules[0].body, 'height');
    expect(h).not.toBeNull();
    expect(h).toBeGreaterThanOrEqual(28);
    expect(h).toBeLessThanOrEqual(34);
  });

  it('reader-actions has no gradient', () => {
    const rules = findRules(readerCss, '.reader-actions');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).not.toMatch(/gradient/);
    }
  });
});

describe('reader de-AI contract — delete is neutral by default, danger on hover', () => {
  it('danger-action base has no danger colour', () => {
    const rules = findRules(readerCss, '.danger-action');
    // Base rules (no :hover in selector) should not set --ui-danger
    const baseRules = rules.filter((r) => !r.selector.includes('hover'));
    for (const r of baseRules) {
      expect(r.body).not.toMatch(/color:\s*var\(--ui-danger\)/);
    }
  });

  it('danger-action hover uses danger semantic tokens', () => {
    const rules = findRules(readerCss, '.danger-action');
    const hoverRules = rules.filter((r) =>
      r.selector.includes('hover') && r.selector.includes('danger-action'),
    );
    expect(hoverRules.length).toBeGreaterThan(0);
    const hasDanger = hoverRules.some((r) =>
      r.body.match(/color:\s*var\(--ui-danger\)/),
    );
    const hasDangerBg = hoverRules.some((r) =>
      r.body.match(/background:\s*var\(--ui-danger-bg\)/),
    );
    expect(hasDanger).toBe(true);
    expect(hasDangerBg).toBe(true);
  });
});

describe('reader de-AI contract — avatar tones are muted neutral', () => {
  it('avatar-tone classes use semantic tokens, not hardcoded hex', () => {
    // The avatar tones are defined in a comma-separated group:
    // .avatar-tone-0, .avatar-tone-1, ... .avatar-tone-5 { ... }
    // Find the group rule and check it uses var() for color and background.
    const rules = findRules(readerCss, 'avatar-tone-0');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).toMatch(/color:\s*var\(/);
      expect(r.body).toMatch(/background:\s*var\(/);
      expect(r.body).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });
});

describe('reader de-AI contract — dark mode reader overrides use semantic tokens', () => {
  it('dark-mode.css reader sections have no !important', () => {
    const selectors = [
      '.reader-actions',
      '.reader-warning-panel',
      '.quick-reply',
      '.body-text',
      '.reader-html',
    ];

    for (const sel of selectors) {
      const rules = findRules(darkModeCss, sel);
      for (const r of rules) {
        if (r.selector.includes('data-theme="dark"')) {
          expect(r.body, `${sel} in dark-mode.css must not use !important`).not.toContain('!important');
        }
      }
    }
  });

  it('dark-mode.css reader sections have no hardcoded hex', () => {
    const selectors = [
      '.reader-actions',
      '.body-text',
      '.reader-html',
      '.quick-reply',
      '.reader-warning-panel',
    ];

    for (const sel of selectors) {
      const rules = findRules(darkModeCss, sel);
      for (const r of rules) {
        if (r.selector.includes('data-theme="dark"')) {
          expect(r.body, `${sel} in dark-mode.css must not contain hex`).not.toMatch(
            /#[0-9a-fA-F]{3,8}/,
          );
        }
      }
    }
  });
});

describe('reader de-AI contract — Shadow DOM email styles use inherited tokens', () => {
  it('EmailShadowView inline styles use var() for link colour, not hex fallback', () => {
    expect(emailShadowTs).toMatch(/var\(--ui-accent\)/);
    expect(emailShadowTs).not.toMatch(/var\(--accent,/);
  });

  it('EmailShadowView inline styles use var() for blockquote, not hex', () => {
    expect(emailShadowTs).not.toMatch(/#c7d2de/);
    expect(emailShadowTs).not.toMatch(/#58636f/);
    expect(emailShadowTs).not.toMatch(/#f8f9fb/);
    expect(emailShadowTs).toMatch(/var\(--ui-border-strong\)/);
    expect(emailShadowTs).toMatch(/var\(--ui-text-secondary\)/);
    expect(emailShadowTs).toMatch(/var\(--ui-surface-muted\)/);
  });

  it('EmailShadowView inline styles use token for image hover shadow, not rgba', () => {
    expect(emailShadowTs).not.toMatch(/rgba\(15,\s*23,\s*42/);
    expect(emailShadowTs).toMatch(/var\(--ui-shadow-popover\)/);
  });
});

describe('reader de-AI contract — TSX inline styles use semantic tokens', () => {
  it('PlainMessageBody uses var(--ui-accent) for all link colours', () => {
    expect(plainMessageTs).toMatch(/var\(--ui-accent\)/);
    expect(plainMessageTs).not.toMatch(/var\(--color-primary,/);
    expect(plainMessageTs).not.toMatch(/#2563eb/);
  });

  it('ReaderLabelMenu uses var() for fallback colour, not hex', () => {
    expect(readerLabelMenuTs).not.toMatch(/#8b95a1/);
    expect(readerLabelMenuTs).toMatch(/var\(--ui-text-tertiary\)/);
  });
});

describe('reader de-AI contract — thread is a list, not floating cards', () => {
  it('thread-message has no floating box-shadow', () => {
    const rules = findRules(readerCss, '.thread-message');
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r.body).not.toMatch(/box-shadow:\s*var\(--ui-shadow(?!-none)/);
    }
  });

  it('thread-message has transparent background by default', () => {
    const rules = findRules(readerCss, '.thread-message');
    expect(rules.length).toBeGreaterThan(0);
    const hasTransparent = rules.some((r) =>
      r.body.match(/background:\s*transparent/),
    );
    expect(hasTransparent).toBe(true);
  });

  it('thread-message has border-bottom divider, not full border card', () => {
    const rules = findRules(readerCss, '.thread-message');
    expect(rules.length).toBeGreaterThan(0);
    const hasBorderBottom = rules.some((r) =>
      r.body.match(/border-bottom:\s*1px/),
    );
    expect(hasBorderBottom).toBe(true);
  });
});

describe('reader de-AI contract — label dot has base styles', () => {
  it('label-dot has width, height, and border-radius', () => {
    const rules = findRules(readerCss, '.label-dot');
    expect(rules.length).toBeGreaterThan(0);
    const hasSize = rules.some((r) =>
      r.body.match(/width:\s*\d+px/) && r.body.match(/height:\s*\d+px/),
    );
    expect(hasSize).toBe(true);
    const hasRadius = rules.some((r) =>
      r.body.match(/border-radius:\s*50%/),
    );
    expect(hasRadius).toBe(true);
  });
});
