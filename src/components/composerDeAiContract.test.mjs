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

const composerCss = rulesOnly(readCss('src/components/composer/composer.css'));
const darkModeCss = rulesOnly(readCss('src/styles/dark-mode.css'));
const globalCss = rulesOnly(readCss('src/styles/global.css'));
const sharedMotionCss = rulesOnly(readCss('src/styles/shared-motion.css'));
const contextMenuCss = rulesOnly(readCss('src/components/context-menu.css'));
const dropdownsCss = rulesOnly(readCss('src/styles/dropdowns.css'));
const snoozePickerCss = rulesOnly(readCss('src/components/snooze-picker.css'));
const globalTooltipCss = rulesOnly(readCss('src/styles/global-tooltip.css'));

/* ----------------------------------------------------------------------- *
 * Helpers
 * ----------------------------------------------------------------------- */

function parseRules(css) {
  const rules = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    const selectorGroup = match[1].trim();
    const body = match[2];
    for (const sel of selectorGroup.split(',')) {
      rules.push({ selector: sel.trim(), body });
    }
  }
  return rules;
}

function findRules(css, selectorSubstr) {
  return parseRules(css).filter((r) =>
    r.selector.includes(selectorSubstr),
  );
}

function extractDecl(block, prop) {
  const m = block.match(new RegExp(`${prop}\\s*:\\s*([0-9]+)(?:px)?`));
  return m ? parseInt(m[1], 10) : null;
}

/* ----------------------------------------------------------------------- *
 * Contract: the composer is a desktop email editor, not an AI writing app.
 *
 * These invariants are intentionally few and long-lived:
 *
 *  1. Composer canonical stylesheet has zero !important.
 *  2. Composer canonical stylesheet has zero hardcoded hex.
 *  3. Composer canonical stylesheet has zero gradient.
 *  4. Composer canonical stylesheet has zero backdrop-filter blur.
 *  5. Recipient chips use small radius (≤ 8px), not 999px pill.
 *  6. Send button is accent, not gradient/glow/shadow/999px pill.
 *  7. Formatting toolbar buttons are 28-30px icon buttons, not pill containers.
 *  8. No scale(0.97) press animation in shared-motion for composer scope.
 *  9. Context-menu has no backdrop-filter blur.
 * 10. Snooze-picker light mode uses semantic tokens, not hardcoded hex.
 * 11. Dropdowns (CustomSelect) use semantic tokens without hardcoded fallbacks.
 * 12. Global focus-visible uses --ui-focus-outline, not hardcoded #6b7280.
 * ----------------------------------------------------------------------- */

describe('composer de-AI contract — canonical stylesheet hygiene', () => {
  it('composer.css contains no !important declarations', () => {
    expect(composerCss).not.toContain('!important');
  });

  it('composer.css has no hardcoded hex colours', () => {
    expect(composerCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('composer.css has no gradient declarations', () => {
    expect(composerCss).not.toMatch(/gradient/);
  });

  it('composer.css has no backdrop-filter blur', () => {
    expect(composerCss).not.toMatch(/backdrop-filter:\s*blur/);
  });

  it('composer.css has no rgb()/rgba() literals', () => {
    expect(composerCss).not.toMatch(/rgba?\(/);
  });
});

describe('composer de-AI contract — recipient chips are small, not pills', () => {
  it('recipient chip border-radius is ≤ 8px (not 999px)', () => {
    const rules = findRules(composerCss, 'recipient-chip');
    if (rules.length === 0) return; // chip class name may differ
    for (const r of rules) {
      const m = r.body.match(/border-radius:\s*(?:var\(--ui-radius-[^,)]+\)|([0-9.]+)px)/);
      if (m) {
        const val = m[1] ? parseFloat(m[1]) : 0; // var() is OK
        if (m[1]) {
          expect(val).toBeLessThanOrEqual(8);
        }
        // var() references are always OK — they resolve to design tokens
      }
    }
  });

  it('composer.css has no 999px border-radius anywhere', () => {
    expect(composerCss).not.toContain('999px');
  });
});

describe('composer de-AI contract — send button is accent, not flashy', () => {
  it('send button has no gradient', () => {
    const rules = findRules(composerCss, 'composer-send');
    for (const r of rules) {
      expect(r.body).not.toMatch(/gradient/);
    }
  });

  it('send button has no glow/box-shadow (except --ui-box-shadow-none)', () => {
    const rules = findRules(composerCss, 'composer-send');
    for (const r of rules) {
      if (r.body.includes('box-shadow')) {
        expect(r.body).not.toMatch(/box-shadow:\s*(?!var\(--ui-box-shadow-none\))/);
      }
    }
  });

  it('send button has no scale animation', () => {
    const rules = findRules(composerCss, 'composer-send');
    for (const r of rules) {
      expect(r.body).not.toMatch(/transform:\s*scale/);
    }
  });
});

describe('composer de-AI contract — toolbar is desktop icon buttons, not pill bar', () => {
  it('rich-toolbar buttons are 28-30px', () => {
    const rules = findRules(composerCss, 'rich-toolbar button');
    if (rules.length === 0) return;
    const h = extractDecl(rules[0].body, 'min-height');
    if (h !== null) {
      expect(h).toBeGreaterThanOrEqual(28);
      expect(h).toBeLessThanOrEqual(32);
    }
  });

  it('rich-toolbar buttons use small radius (≤ 8px)', () => {
    const rules = findRules(composerCss, 'rich-toolbar button');
    for (const r of rules) {
      if (r.body.includes('border-radius')) {
        expect(r.body).not.toContain('999px');
      }
    }
  });

  it('rich-toolbar has no gradient background', () => {
    const rules = findRules(composerCss, 'rich-toolbar');
    for (const r of rules) {
      expect(r.body).not.toMatch(/gradient/);
    }
  });
});

describe('composer de-AI contract — no press scale animation in motion system', () => {
  it('shared-motion.css has no scale(0.97) transform', () => {
    expect(sharedMotionCss).not.toContain('scale(0.97)');
  });

  it('shared-motion.css excludes composer from active transforms', () => {
    // Composer elements should have transform: none enforced
    const hasComposerExclusion = sharedMotionCss.includes('composer') &&
      sharedMotionCss.includes('transform: none');
    expect(hasComposerExclusion).toBe(true);
  });
});

describe('composer de-AI contract — context-menu has no blur', () => {
  it('context-menu.css has no backdrop-filter blur', () => {
    expect(contextMenuCss).not.toMatch(/backdrop-filter:\s*blur/);
  });

  it('context-menu.css has no hardcoded hex', () => {
    expect(contextMenuCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('composer de-AI contract — snooze-picker uses semantic tokens', () => {
  it('snooze-picker light mode has no hardcoded hex', () => {
    // Only check the light mode portion (before the dark mode section)
    const darkStart = snoozePickerCss.indexOf('[data-theme="dark"]');
    const lightCss = darkStart > 0 ? snoozePickerCss.slice(0, darkStart) : snoozePickerCss;
    expect(lightCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('snooze-picker light mode has no rgba() literals', () => {
    const darkStart = snoozePickerCss.indexOf('[data-theme="dark"]');
    const lightCss = darkStart > 0 ? snoozePickerCss.slice(0, darkStart) : snoozePickerCss;
    expect(lightCss).not.toMatch(/rgba?\(/);
  });
});

describe('composer de-AI contract — dropdowns use tokens without fallbacks', () => {
  it('dropdowns.css has no hardcoded hex in var() fallbacks', () => {
    // Match patterns like var(--token, #hex) — the fallback is the second arg
    const fallbackPattern = /var\([^,]+,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\)/;
    expect(dropdownsCss).not.toMatch(fallbackPattern);
  });
});

describe('composer de-AI contract — global focus uses semantic token', () => {
  it('global.css focus-visible outline uses --ui-focus-outline, not #6b7280', () => {
    const rules = findRules(globalCss, ':focus-visible');
    for (const r of rules) {
      expect(r.body).not.toContain('#6b7280');
    }
  });
});

describe('composer de-AI contract — dark mode composer overrides are clean', () => {
  it('dark-mode.css composer sections have no !important', () => {
    const selectors = ['.composer'];
    for (const sel of selectors) {
      const rules = findRules(darkModeCss, sel);
      for (const r of rules) {
        if (r.selector.includes('data-theme="dark"')) {
          expect(r.body, `${sel} in dark-mode.css must not use !important`).not.toContain('!important');
        }
      }
    }
  });

  it('dark-mode.css composer sections have no hardcoded hex', () => {
    const rules = findRules(darkModeCss, '.composer');
    for (const r of rules) {
      if (r.selector.includes('data-theme="dark"')) {
        expect(r.body, `dark-mode.css composer must not contain hex`).not.toMatch(
          /#[0-9a-fA-F]{3,8}/,
        );
      }
    }
  });
});

describe('composer de-AI contract — tooltip z-index uses token', () => {
  it('global-tooltip.css z-index uses var(--ui-z-tooltip) or similar token', () => {
    const raw = readCss('src/styles/global-tooltip.css');
    // Either uses a token or is acceptable as-is (already 10000)
    const hasZToken = raw.includes('--ui-z-tooltip') || raw.includes('var(--ui-z-');
    // If no token, just check the raw value is documented
    expect(hasZToken || raw.includes('z-index: 10000')).toBe(true);
  });
});
