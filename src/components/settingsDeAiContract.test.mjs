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

const settingsTokensCss = rulesOnly(readCss('src/components/settings/settings-tokens.css'));
const settingsComponentsCss = rulesOnly(readCss('src/components/settings/settings-components.css'));
const settingsLayoutCss = rulesOnly(readCss('src/components/settings/settings-layout.css'));
const settingsFoundationCss = rulesOnly(readCss('src/components/settings/settings-foundation.css'));
const settingsPagesCss = rulesOnly(readCss('src/components/settings/settings-pages.css'));
const onboardingCss = rulesOnly(readCss('src/components/first-run-onboarding.css'));
const notificationsCss = rulesOnly(readCss('src/components/notifications.css'));
const accountLoginCss = rulesOnly(readCss('src/components/account-login-dialog.css'));
const sharedDialogsCss = rulesOnly(readCss('src/styles/shared-dialogs.css'));
const skeletonCss = rulesOnly(readCss('src/styles/skeleton.css'));
const darkModeCss = rulesOnly(readCss('src/styles/dark-mode.css'));

const allSettingsCss = [
  settingsTokensCss,
  settingsComponentsCss,
  settingsLayoutCss,
  settingsFoundationCss,
  settingsPagesCss,
].join('\n');

const aiServiceTs = readTs('src/components/settings/AiServiceSettings.tsx');
const aboutTs = readTs('src/components/settings/AboutSettings.tsx');
const onboardingTs = readTs('src/components/FirstRunOnboarding.tsx');

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

/* ----------------------------------------------------------------------- *
 * Contract: Settings is a quiet section-based configuration panel, not
 * a card-based AI SaaS dashboard.
 *
 *  1. No !important in any settings CSS.
 *  2. No hardcoded hex/rgba in settings CSS.
 *  3. No gradients in settings CSS.
 *  4. No persistent backdrop-filter blur in settings CSS.
 *  5. .st-section is not a card (no border, radius, shadow, hover-shadow).
 *  6. Toggle is 36x20px (not 44x24px).
 *  7. Radius tokens are small (sm<=8, modal<=10).
 *  8. No gradient hero in onboarding CSS.
 *  9. No persistent blur in onboarding (transient backdrop <=2px ok).
 * 10. No hardcoded colours in onboarding/notifications/account-login/shared-dialogs.
 * 11. No !important in onboarding/notifications/account-login/shared-dialogs.
 * 12. No gradient progress bar in notifications.
 * 13. About page has no hero card / oversized brand mark.
 * 14. AI settings copy is neutral, not marketing.
 * 15. Dark-mode.css has no stale account-login overrides.
 * ----------------------------------------------------------------------- */

describe('settings de-AI contract — no !important', () => {
  it('settings-tokens.css has no !important', () => {
    expect(settingsTokensCss).not.toContain('!important');
  });
  it('settings-components.css has no !important', () => {
    expect(settingsComponentsCss).not.toContain('!important');
  });
  it('settings-layout.css has no !important', () => {
    expect(settingsLayoutCss).not.toContain('!important');
  });
  it('settings-foundation.css has no !important', () => {
    expect(settingsFoundationCss).not.toContain('!important');
  });
  it('settings-pages.css has no !important', () => {
    expect(settingsPagesCss).not.toContain('!important');
  });
});

describe('settings de-AI contract — no hardcoded colours', () => {
  it('all settings CSS has no hardcoded hex', () => {
    expect(allSettingsCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('all settings CSS has no rgb()/rgba() literals', () => {
    expect(allSettingsCss).not.toMatch(/rgba?\(/);
  });
});

describe('settings de-AI contract — no gradients in settings CSS', () => {
  it('all settings CSS has no gradient declarations', () => {
    expect(allSettingsCss).not.toMatch(/gradient/);
  });
});

describe('settings de-AI contract — no persistent blur in settings CSS', () => {
  it('all settings CSS has no backdrop-filter blur', () => {
    expect(allSettingsCss).not.toMatch(/backdrop-filter:\s*blur/);
  });
});

describe('settings de-AI contract — .st-section is not a card', () => {
  it('.st-section has no border (border: 0)', () => {
    const rules = findRules(settingsComponentsCss, '.st-section');
    const baseRule = rules.find((r) => r.selector === '.settings-modal .st-section');
    expect(baseRule).toBeDefined();
    expect(baseRule.body).toMatch(/border:\s*0/);
  });
  it('.st-section has no border-radius (radius: 0)', () => {
    const rules = findRules(settingsComponentsCss, '.st-section');
    const baseRule = rules.find((r) => r.selector === '.settings-modal .st-section');
    expect(baseRule).toBeDefined();
    expect(baseRule.body).toMatch(/border-radius:\s*0/);
  });
  it('.st-section has no box-shadow (shadow: none)', () => {
    const rules = findRules(settingsComponentsCss, '.st-section');
    const baseRule = rules.find((r) => r.selector === '.settings-modal .st-section');
    expect(baseRule).toBeDefined();
    expect(baseRule.body).toMatch(/box-shadow:\s*none/);
  });
  it('.st-section has transparent background', () => {
    const rules = findRules(settingsComponentsCss, '.st-section');
    const baseRule = rules.find((r) => r.selector === '.settings-modal .st-section');
    expect(baseRule).toBeDefined();
    expect(baseRule.body).toMatch(/background:\s*transparent/);
  });
});

describe('settings de-AI contract — toggle is compact 36x20px', () => {
  it('toggle checkbox width is 36px', () => {
    const rules = findRules(settingsComponentsCss, '.st-switch input');
    const checkboxRule = rules.find((r) =>
      r.selector === '.settings-modal .st-switch input[type="checkbox"]',
    );
    expect(checkboxRule).toBeDefined();
    expect(checkboxRule.body).toMatch(/width:\s*36px/);
  });
  it('toggle checkbox height is 20px', () => {
    const rules = findRules(settingsComponentsCss, '.st-switch input');
    const checkboxRule = rules.find((r) =>
      r.selector === '.settings-modal .st-switch input[type="checkbox"]',
    );
    expect(checkboxRule).toBeDefined();
    expect(checkboxRule.body).toMatch(/height:\s*20px/);
  });
});

describe('settings de-AI contract — radius tokens are small', () => {
  it('--st-radius-sm is <= 8px', () => {
    const m = settingsTokensCss.match(/--st-radius-sm:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(parseInt(m[1], 10)).toBeLessThanOrEqual(8);
  });
  it('--st-radius-modal is <= 10px', () => {
    const m = settingsTokensCss.match(/--st-radius-modal:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(parseInt(m[1], 10)).toBeLessThanOrEqual(10);
  });
});

describe('settings de-AI contract — --st-shadow-card is none', () => {
  it('--st-shadow-card is none', () => {
    expect(settingsTokensCss).toMatch(/--st-shadow-card:\s*none/);
  });
});

describe('onboarding de-AI contract — no gradient hero or persistent blur', () => {
  it('onboarding CSS has no gradient declarations', () => {
    expect(onboardingCss).not.toMatch(/gradient/);
  });
  it('onboarding CSS has no hardcoded hex', () => {
    expect(onboardingCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('onboarding CSS has no !important', () => {
    expect(onboardingCss).not.toContain('!important');
  });
  it('onboarding CSS has no backdrop blur > 2px', () => {
    const matches = [...onboardingCss.matchAll(/backdrop-filter:\s*blur\((\d+)px\)/g)];
    for (const m of matches) {
      expect(parseInt(m[1], 10)).toBeLessThanOrEqual(2);
    }
  });
});

describe('system states de-AI contract — notifications', () => {
  it('notifications CSS has no gradient', () => {
    expect(notificationsCss).not.toMatch(/gradient/);
  });
  it('notifications CSS has no hardcoded hex', () => {
    expect(notificationsCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('notifications CSS has no !important', () => {
    expect(notificationsCss).not.toContain('!important');
  });
});

describe('system states de-AI contract — account-login-dialog', () => {
  it('account-login CSS has no hardcoded hex', () => {
    expect(accountLoginCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('account-login CSS has no !important', () => {
    expect(accountLoginCss).not.toContain('!important');
  });
  it('account-login CSS has no gradient', () => {
    expect(accountLoginCss).not.toMatch(/gradient/);
  });
  it('account-login CSS has no backdrop blur > 2px', () => {
    const matches = [...accountLoginCss.matchAll(/backdrop-filter:\s*blur\((\d+)px\)/g)];
    for (const m of matches) {
      expect(parseInt(m[1], 10)).toBeLessThanOrEqual(2);
    }
  });
});

describe('system states de-AI contract — shared-dialogs', () => {
  it('shared-dialogs CSS has no hardcoded hex', () => {
    expect(sharedDialogsCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('shared-dialogs CSS has no !important', () => {
    expect(sharedDialogsCss).not.toContain('!important');
  });
});

describe('system states de-AI contract — skeleton', () => {
  it('skeleton CSS has no hardcoded hex', () => {
    expect(skeletonCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it('skeleton CSS has no rgba() literals', () => {
    expect(skeletonCss).not.toMatch(/rgba?\(/);
  });
});

describe('dark-mode de-AI contract — no stale account-login overrides', () => {
  it('dark-mode.css has no account-login-backdrop selector', () => {
    expect(darkModeCss).not.toMatch(/account-login-backdrop/);
  });
  it('dark-mode.css has no account-login-dialog selector', () => {
    expect(darkModeCss).not.toMatch(/account-login-dialog/);
  });
});

describe('copy de-AI contract — neutral product language', () => {
  it('AiServiceSettings has no "AI 智能引擎" marketing copy', () => {
    expect(aiServiceTs).not.toMatch(/AI 智能引擎/);
  });
  it('AiServiceSettings has no "一键摘要" marketing copy', () => {
    expect(aiServiceTs).not.toMatch(/一键摘要/);
  });
  it('AboutSettings has no "Calm, private email" English tagline', () => {
    expect(aboutTs).not.toMatch(/Calm, private email/i);
  });
  it('FirstRunOnboarding title is not "欢迎使用"', () => {
    expect(onboardingTs).not.toMatch(/欢迎使用/);
  });
});
