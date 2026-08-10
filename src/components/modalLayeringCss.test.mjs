import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * 弹层层级契约（纯 CSS 源码校验）：
 *   first-run-onboarding-backdrop   2500（首次引导）
 *   contact-import-backdrop         2600（联系人导入 portal，必须高于引导）
 *   reader-image-preview-backdrop   2700（图片预览，必须高于联系人导入）
 *   window-chrome                   3000（真实窗口关闭按钮，登录/引导/图片预览期间可见可点）
 */
function readCss(relative) {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

function extractZIndex(css, selector) {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let match;
  while ((match = pattern.exec(css)) !== null) {
    const zIndex = /z-index\s*:\s*(\d+)/.exec(match[1]);
    if (zIndex) return Number(zIndex[1]);
  }
  return null;
}

describe('modal 层叠层级契约', () => {
  const hierarchyCss = readCss('src/styles/2026/workspace-hierarchy.css');
  const onboardingCss = readCss('src/components/first-run-onboarding.css');
  const windowChromeCss = readCss('src/styles/window-chrome.css');

  it('首次引导 z-index 为 2500', () => {
    expect(extractZIndex(onboardingCss, '.first-run-onboarding-backdrop')).toBe(2500);
  });

  it('联系人导入 portal（2600）高于首次引导（2500）', () => {
    const onboarding = extractZIndex(onboardingCss, '.first-run-onboarding-backdrop');
    const importLayer = extractZIndex(hierarchyCss, '.contact-import-backdrop');
    expect(onboarding).toBe(2500);
    expect(importLayer).toBe(2600);
    expect(importLayer).toBeGreaterThan(onboarding);
  });

  it('图片预览（2700）高于联系人导入（2600）', () => {
    const importLayer = extractZIndex(hierarchyCss, '.contact-import-backdrop');
    const previewLayer = extractZIndex(hierarchyCss, '.reader-image-preview-backdrop');
    expect(importLayer).toBe(2600);
    expect(previewLayer).toBe(2700);
    expect(previewLayer).toBeGreaterThan(importLayer);
  });

  it('WindowChrome 关闭按钮（3000）在登录、引导和图片预览期间明确可见可点', () => {
    const css = windowChromeCss;
    expect(css).toMatch(/body:has\(\.account-login-gate\) \.window-chrome/);
    expect(css).toMatch(/body:has\(\.first-run-onboarding-backdrop\) \.window-chrome/);
    expect(css).toMatch(/body\[data-image-preview-modal='1'\] \.window-chrome/);
    // 规则以逗号合并多选择器，须从合并规则块中提取 z-index。
    const block = css.match(
      /body:has\(\.account-login-gate\) \.window-chrome[^{]*\{([^}]*)\}/,
    );
    expect(block).not.toBeNull();
    expect(Number(/z-index\s*:\s*(\d+)/.exec(block[1])?.[1])).toBe(3000);
  });

  it('联系人导入弹窗本身带 portal 遮罩类（contact-import-backdrop）', () => {
    // 组件类名契约：ContactImportDialog 渲染到 document.body 的遮罩必须使用该层级类。
    const componentSource = readCss('src/components/settings/ContactImportDialog.tsx');
    expect(componentSource).toContain('contact-import-backdrop');
  });
});
