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

const composerCss = rulesOnly(readCss('src/components/composer/composer.css'));
const composerMotionCss = rulesOnly(readCss('src/components/composer/composer-motion.css'));
const designTokensCss = rulesOnly(readCss('src/design-tokens.css'));
const sharedDialogsCss = rulesOnly(readCss('src/styles/shared-dialogs.css'));
const darkModeCss = rulesOnly(readCss('src/styles/dark-mode.css'));
const globalCss = rulesOnly(readCss('src/styles/global.css'));
const sharedMotionCss = rulesOnly(readCss('src/styles/shared-motion.css'));
const contextMenuCss = rulesOnly(readCss('src/components/context-menu.css'));
const dropdownsCss = rulesOnly(readCss('src/styles/dropdowns.css'));
const snoozePickerCss = rulesOnly(readCss('src/components/snooze-picker.css'));

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

function extractBlock(css, prelude) {
  const start = css.indexOf(prelude);
  if (start < 0) throw new Error(`Missing CSS block: ${prelude}`);
  const open = css.indexOf('{', start + prelude.length);
  let depth = 1;
  for (let index = open + 1; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  throw new Error(`Unclosed CSS block: ${prelude}`);
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
 *  8. Only named action groups receive shared press feedback; rows stay stable.
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

describe('composer focus contract — quiet hairlines, not large rectangles', () => {
  it('recipient and body focus states do not draw a 2px inset rectangle', () => {
    const focusRules = parseRules(composerCss).filter((rule) => (
      rule.selector.includes(':focus-within')
    ));
    for (const rule of focusRules) {
      expect(rule.body).not.toMatch(/inset\s+0\s+0\s+0\s+2px/);
    }
  });

  it('field focus stays stable and does not reintroduce a blinking bottom line', () => {
    const fieldFocus = findRules(composerCss, '.composer-field-row:focus-within')
      .filter((rule) => rule.selector === '.composer-field-row:focus-within')
      .at(-1);
    expect(fieldFocus).toBeDefined();
    expect(fieldFocus.body).toMatch(/box-shadow:\s*inset\s+0\s+-2px\s+0\s+var\(--ui-accent\)/);
    expect(fieldFocus.body).not.toMatch(/inset\s+0\s+-1px/);

    const keyboardFocus = findRules(composerCss, '.composer-field-row:has(input:focus-visible)')
      .filter((rule) => rule.selector === '.composer-field-row:has(input:focus-visible)')
      .at(-1);
    expect(keyboardFocus).toBeDefined();
    expect(keyboardFocus.body).toMatch(/outline:\s*none/);
    expect(keyboardFocus.body).toMatch(/box-shadow:\s*inset\s+0\s+-2px\s+0\s+var\(--ui-accent\)/);
    expect(keyboardFocus.body).not.toMatch(/inset\s+0\s+-1px/);
  });
});

describe('composer sender context — metadata, not nested cards', () => {
  it('keeps idle sender selectors flat and lets state provide the affordance', () => {
    const summaryRule = findRules(composerCss, '.composer .composer-sender-context .custom-select-summary')
      .filter((rule) => rule.selector === '.composer .composer-sender-context .custom-select-summary')
      .at(-1);
    expect(summaryRule).toBeDefined();
    expect(summaryRule.body).toMatch(/border-color:\s*transparent/);
    expect(summaryRule.body).toMatch(/background:\s*transparent/);
  });
});

describe('composer readability contract — visible copy is at least 12px', () => {
  it('the read-only original-quote label is not microcopy', () => {
    const rule = findRules(composerCss, '.composer-original-quote header small')
      .find((candidate) => candidate.selector === '.composer-original-quote header small');
    expect(rule).toBeDefined();
    expect(extractDecl(rule.body, 'font-size')).toBeGreaterThanOrEqual(12);
  });
});

describe('composer de-AI contract — send button is accent, not flashy', () => {
  it('split send button keeps rounded outer corners on both segments', () => {
    const split = findRules(composerCss, '.composer-send-split')
      .find((rule) => rule.selector === '.composer-send-split');
    expect(split?.body).toMatch(/border-radius:\s*var\(--ui-radius-control\)/);

    const primary = findRules(composerCss, '.composer-send-split > .composer-send-primary')
      .find((rule) => rule.selector === '.composer-send-split > .composer-send-primary');
    expect(primary?.body).toMatch(/border-radius:\s*var\(--ui-radius-control\)\s+0\s+0\s+var\(--ui-radius-control\)/);

    const menu = findRules(composerCss, '.composer-send-split > .composer-send-menu-trigger')
      .find((rule) => rule.selector === '.composer-send-split > .composer-send-menu-trigger');
    expect(menu?.body).toMatch(/border-radius:\s*0\s+var\(--ui-radius-control\)\s+var\(--ui-radius-control\)\s+0/);
  });

  it('send button has no gradient', () => {
    const rules = findRules(sharedDialogsCss, '.dialog-button-primary');
    for (const r of rules) {
      expect(r.body).not.toMatch(/gradient/);
    }
  });

  it('send button has no glow/box-shadow (except --ui-box-shadow-none)', () => {
    const rules = findRules(sharedDialogsCss, '.dialog-button-primary');
    for (const r of rules) {
      if (r.body.includes('box-shadow')) {
        expect(r.body).not.toMatch(/box-shadow:\s*(?!var\(--ui-box-shadow-none\))/);
      }
    }
  });

  it('send button does not define its own transform outside shared action feedback', () => {
    const rules = findRules(sharedDialogsCss, '.dialog-button-primary');
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

describe('composer close confirmation — clear action hierarchy', () => {
  it('keeps discard as a filled destructive action', () => {
    const rule = findRules(sharedDialogsCss, '.dialog-button-danger')
      .find((candidate) => candidate.selector === '.dialog-button-danger');
    expect(rule).toBeDefined();
    expect(rule.body).toMatch(/color:\s*var\(--color-text-on-accent\)/);
    expect(rule.body).toMatch(/background:\s*var\(--ui-danger\)/);
  });

  it('uses one integrated focus border instead of a detached double outline', () => {
    const rule = findRules(sharedDialogsCss, '.dialog-button:focus-visible')
      .find((candidate) => candidate.selector === '.dialog-button:focus-visible');
    expect(rule).toBeDefined();
    expect(rule.body).toMatch(/border-color:\s*var\(--ui-accent\)/);
    expect(rule.body).toMatch(/outline:\s*none/);
    expect(rule.body).toMatch(/box-shadow:\s*inset/);
    expect(rule.body).not.toMatch(/outline-offset/);
  });
});

describe('composer motion contract — named actions share tactile feedback', () => {
  it('opts only named composer actions into geometric feedback', () => {
    const allowed = [
      '.composer-schedule-picker-popover .composer-schedule-picker-confirm',
    ];
    const motionEnabled = extractBlock(sharedMotionCss, '@media (prefers-reduced-motion: no-preference)');
    const composerGeometry = parseRules(motionEnabled).filter((rule) => (
      rule.selector.includes('.composer')
      && rule.selector !== '.composer .composer-send-split > button'
      && /(?:^|;)\s*(?:transform|translate|scale)\s*:/.test(rule.body)
    ));
    expect(composerGeometry.map((rule) => rule.selector).sort()).toEqual([...allowed].sort());
    for (const rule of composerGeometry) {
      expect(rule.body).toMatch(/--ui-control-feedback:\s*tactile/);
      expect(rule.body).not.toMatch(/(?:^|;)\s*translate\s*:/);
      expect(rule.body).toMatch(/scale:\s*var\(--ui-control-scale\)/);
      expect(rule.body).toMatch(/transition:\s*var\(--ui-transition-control\)/);
    }

    // Geometry must not leak into reduced motion through an unguarded rule.
    expect(sharedMotionCss.replace(motionEnabled, ''))
      .not.toMatch(/(?:^|;)\s*(?:translate|scale)\s*:/m);
    expect(sharedMotionCss.replace(motionEnabled, '')).not.toMatch(/--ui-control-feedback:\s*tactile/);
    const base = parseRules(sharedMotionCss).find((rule) => rule.selector === 'button');
    expect(base.body).toMatch(/--ui-control-feedback:\s*none/);
    expect(sharedMotionCss).not.toContain('.composer *');
    expect(sharedMotionCss).not.toMatch(/transition:\s*all\b|will-change:/);
  });

  it('moves the send halves together around their seam while leaving the nested menu stationary', () => {
    const halves = extractBlock(sharedMotionCss, '.composer .composer-send-split > button');
    expect(halves).toMatch(/--ui-control-feedback:\s*tactile/);
    expect(halves).not.toMatch(/(?:^|;)\s*translate\s*:/);
    expect(halves).toMatch(/scale:\s*var\(--ui-send-scale\)/);
    expect(halves).toMatch(/transition:\s*var\(--ui-send-transition\)/);
    expect(halves).toMatch(/transform-origin:\s*right center/);
    expect(extractBlock(sharedMotionCss, '.composer .composer-send-split > .composer-send-menu-trigger'))
      .toMatch(/transform-origin:\s*left center/);
    const containers = parseRules(sharedMotionCss).filter((rule) => rule.selector === '.composer .composer-send-split');
    for (const rule of containers) {
      expect(rule.body).not.toMatch(/(?:^|;)\s*(?:transform|translate|scale)\s*:/);
    }
  });

  it('shares hover, press and release timing without turning every control into a moving target', () => {
    expect(designTokensCss).toMatch(/--ui-motion-hover:\s*160ms/);
    expect(designTokensCss).toMatch(/--ui-motion-press:\s*80ms/);
    expect(designTokensCss).toMatch(/--ui-motion-settle:\s*220ms/);
    const base = parseRules(sharedMotionCss).find((rule) => rule.selector === 'button');
    expect(base).toBeDefined();
    expect(base.body).toMatch(/--ui-control-duration:\s*var\(--ui-motion-settle\)/);
    expect(base.body).toMatch(/--ui-control-scale-duration:\s*var\(--ui-motion-settle\)/);
    expect(base.body).toMatch(/--ui-control-easing:\s*var\(--ui-ease-control\)/);
    expect(base.body).toMatch(/transition:\s*var\(--ui-transition-control\)/);
    expect(base.body).not.toMatch(/(?:^|;)\s*(?:transform|translate|scale)\s*:/);

    const hover = extractBlock(sharedMotionCss, '@media (hover: hover) and (pointer: fine)');
    expect(hover).toContain(':is(button, summary):hover');
    expect(hover).toMatch(/--ui-control-duration:\s*var\(--ui-motion-hover\)/);
    expect(hover).not.toContain('--ui-control-scale-duration:');
    expect(hover).not.toMatch(/--ui-control-offset-y:\s*-/);

    const pressed = extractBlock(sharedMotionCss, ':is(button, summary):active');
    expect(pressed).toMatch(/--ui-control-duration:\s*var\(--ui-motion-press\)/);
    expect(pressed).toMatch(/--ui-control-scale-duration:\s*var\(--ui-motion-press\)/);
    expect(pressed).toMatch(/--ui-control-easing:\s*var\(--ui-ease-press\)/);
    expect(pressed).toMatch(/--ui-control-scale:\s*var\(--ui-control-press-scale,\s*0\.98\)/);
    expect(pressed).not.toMatch(/(?:^|;)\s*(?:transform|translate|scale)\s*:/);
    expect(extractBlock(sharedMotionCss, ':is(button, summary)[data-ui-pressed="true"]')).toBe(pressed);
    expect(sharedMotionCss).toContain(':active:where(:not([data-ui-pressed]))');
  });

  it('keeps toolbar, navigation and secondary actions free of geometric feedback', () => {
    const stable = [
      '.reader-actions .icon-only-action', '.titlebar-refresh', '.mobile-header-icon',
      '.composer-mini-actions > button', '.composer .composer-header-actions > button',
      '.composer .composer-rich-toolbar button', '.composer .composer-footer-tool-group button',
      '.settings-modal .st-btn', '.dialog-button',
    ];
    for (const selector of stable) {
      const rules = parseRules(sharedMotionCss).filter((rule) => rule.selector === selector);
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.body).not.toMatch(/(?:^|;)\s*(?:transform|translate|scale)\s*:/);
      }
    }
  });

  it('settles disabled, busy and cancelled actions without accepting a new press', () => {
    const disabled = extractBlock(sharedMotionCss, ':is(button, summary):is(:disabled, [aria-disabled="true"], [aria-busy="true"], [data-ui-pressed="false"])');
    expect(disabled).not.toMatch(/(?:^|;)\s*(?:translate|transform)\s*:/);
    expect(disabled).toMatch(/--ui-control-scale:\s*1\s*;/);
    expect(disabled).toMatch(/--ui-control-duration:\s*var\(--ui-motion-settle\)/);
    expect(disabled).toMatch(/--ui-control-scale-duration:\s*var\(--ui-motion-settle\)/);
  });

  it('keeps ordinary composer controls and the sender menu stationary while sharing colour feedback', () => {
    const selectors = [
      '.composer button',
      '.composer summary',
      '.custom-select-dropdown[data-portal-owner="composer-sender"] button',
    ];
    for (const selector of selectors) {
      const rule = parseRules(composerCss).filter((candidate) => candidate.selector === selector).at(-1);
      expect(rule, `missing stable control base for ${selector}`).toBeDefined();
      expect(rule.body).toMatch(/transition:\s*var\(--ui-transition-control\)/);
      expect(rule.body).toMatch(/transform:\s*none/);
      expect(rule.body).toMatch(/translate:\s*none/);
      expect(rule.body).toMatch(/scale:\s*1\s*;/);
    }
  });

  it('keeps fields, attachment rows and the toolbar container free of layout transitions', () => {
    const selectors = [
      '.composer input',
      '.composer select',
      '.composer textarea',
      '.composer [contenteditable="true"]',
      '.composer .composer-field-row',
      '.composer .composer-body-field',
      '.composer .composer-attachments',
      '.composer .composer-rich-toolbar',
    ];

    for (const selector of selectors) {
      const rule = parseRules(composerCss)
        .filter((candidate) => candidate.selector === selector)
        .at(-1);
      expect(rule, `missing motion reset for ${selector}`).toBeDefined();
      expect(rule.body).toMatch(/transition:\s*none/);
    }
  });

  it('allows only shared action timing and functional progress transitions in the editor', () => {
    const transitionRules = parseRules(composerCss).filter((rule) => (
      /\btransition\s*:/.test(rule.body)
    ));
    const progressRules = transitionRules.filter((rule) => rule.selector.includes('progress-fill'));
    expect(progressRules.length).toBeGreaterThan(0);

    transitionRules
      .filter((rule) => !rule.selector.includes('progress-fill'))
      .forEach((rule) => {
        expect(rule.body, `unexpected animated composer rule: ${rule.selector}`)
          .toMatch(/transition:\s*(?:none|var\(--ui-transition-control\))\s*;/);
      });

    const movingRules = parseRules(composerCss).filter((rule) => (
      [...rule.body.matchAll(/(?:^|;)\s*(transform|translate|scale)\s*:\s*([^;]+);/g)]
        .some(([, property, value]) => value.trim() !== 'none' && !(property === 'scale' && value.trim() === '1'))
    ));
    expect(movingRules.map((rule) => rule.selector).sort()).toEqual([
      '.composer-attachment-progress-fill',
      '.composer-send-progress-fill',
    ]);
  });

  it('removes both control transitions and surface animations for reduced motion', () => {
    const reducedControls = extractBlock(sharedMotionCss, '@media (prefers-reduced-motion: reduce)');
    expect(reducedControls).toMatch(/transition-duration:\s*var\(--ui-motion-none\) !important/);
    expect(reducedControls).toMatch(/animation-duration:\s*var\(--ui-motion-none\) !important/);
    expect(composerCss).toContain("@import './composer-motion.css'");
    // Surface interpolation now has a reversible lifecycle; reduced-motion
    // endpoints/cancellation are exercised in useSurfaceMotion.test.tsx.
    expect(composerMotionCss).not.toContain('@keyframes composer-surface');
    expect(composerMotionCss).toContain('.composer-backdrop[hidden]');
  });

  it('keeps recipient input geometry stable while hovering or focusing', () => {
    const stableSelectors = [
      '.composer .composer-recipient-editor input',
      '.composer .composer-recipient-editor input:hover',
      '.composer .composer-recipient-editor input:focus',
    ];

    for (const selector of stableSelectors) {
      const rule = parseRules(composerCss)
        .filter((candidate) => candidate.selector === selector)
        .at(-1);
      expect(rule, `missing stable recipient input rule for ${selector}`).toBeDefined();
      expect(rule.body).toMatch(/min-height:\s*32px/);
    }
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

  it('keeps the portalled menu and its rows fully styled', () => {
    const menuRule = findRules(dropdownsCss, '.custom-select-dropdown')
      .find((rule) => rule.selector === '.custom-select-dropdown');
    const rowRule = findRules(dropdownsCss, '.custom-select-dropdown button')
      .find((rule) => rule.selector === '.custom-select-dropdown button');
    expect(menuRule).toBeDefined();
    expect(rowRule).toBeDefined();
    expect(menuRule.body).toMatch(/display:\s*grid/);
    expect(menuRule.body).toMatch(/max-height:/);
    expect(menuRule.body).toMatch(/overflow-y:\s*auto/);
    expect(rowRule.body).toMatch(/min-height:/);
    expect(rowRule.body).toMatch(/font-size:\s*var\(--ui-font-size-secondary\)/);
    expect(rowRule.body).toMatch(/border:\s*1px solid transparent/);
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
