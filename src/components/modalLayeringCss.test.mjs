import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createElement, useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import useSettingsSurfaceMotion from './settings/useSettingsSurfaceMotion';

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
  // 2026 合并后层级分散在各自归属文件：web 弹层在组件/设置层，
  // 阅读区图片预览在 reader.css，关闭按钮在 window-chrome.css。
  const importCss = readCss('src/components/settings/settings-pages.css');
  const previewCss = readCss('src/styles/reader.css');
  const hierarchyCss = `${importCss}\n${previewCss}`;
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

  it.each([
    'settings-shell-enter',
    'settings-shell-exit',
    'settings-page-reveal',
    'settings-mobile-page-forward',
    'settings-mobile-page-backward',
  ])('%s keeps fixed dialog positioning stable throughout the animation', (name) => {
    const css = readCss('src/components/settings/settings-shell.css')
      + readCss('src/components/settings/settings-responsive.css');
    const frames = new RegExp(`@keyframes ${name}\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`).exec(css)?.[1];
    expect(frames).toBeDefined();
    expect(frames).toMatch(/opacity\s*:/);
    // These ancestors use overflow:hidden/auto and host fixed overlays directly
    // or through a portal. Even a zero transform changes their containing block.
    expect(frames).not.toMatch(/(?:^|[;{])\s*(?:transform|translate|scale|rotate|filter|perspective|contain|will-change)\s*:/);
  });

  it.each([true, false])('mobile shell active=%s keeps fixed positioning stable through its interruptible animation', (active) => {
    const originalAnimate = HTMLElement.prototype.animate;
    const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null }));
    HTMLElement.prototype.animate = animate;
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const onExited = () => undefined;
    function MotionSurface({ visible }) {
      const ref = useRef(null);
      useSettingsSurfaceMotion(ref, visible, { enabled: true, onExited });
      return createElement('div', { ref });
    }
    try {
      const view = render(createElement(MotionSurface, { visible: true }));
      if (!active) view.rerender(createElement(MotionSurface, { visible: false }));
      const frames = animate.mock.calls[animate.mock.calls.length - 1][0];
      expect(frames).toHaveLength(2);
      for (const frame of frames) {
        // Only opacity and relative left may vary: transforms, filters or
        // containment would capture the fixed account menus and dialogs.
        expect(Object.keys(frame).sort()).toEqual(['left', 'opacity']);
      }
      expect(frames[1]).toEqual({ left: active ? '0px' : '12px', opacity: active ? 1 : 0 });
      const shellCss = readCss('src/components/settings/settings-shell.css');
      const shell = /\.settings-shell\.settings-modal\s*\{([^}]*)\}/.exec(shellCss)?.[1];
      expect(shell).toMatch(/position:\s*relative/);
      expect(shell).not.toMatch(/(?:^|;)\s*(?:transform|translate|scale|rotate|filter|perspective|contain|will-change)\s*:/);
    } finally {
      cleanup();
      HTMLElement.prototype.animate = originalAnimate;
      vi.unstubAllGlobals();
    }
  });

  it('uses opposite small offsets for mobile navigation without a fixed containing block', () => {
    const css = readCss('src/components/settings/settings-responsive.css');
    expect(css).toMatch(/@keyframes settings-mobile-page-forward\s*\{\s*from\s*\{[^}]*left:\s*12px/);
    expect(css).toMatch(/@keyframes settings-mobile-page-backward\s*\{\s*from\s*\{[^}]*left:\s*-12px/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.settings-page-motion-forward,\s*\.settings-page-motion-backward\s*\{\s*animation: none/);
  });
});
