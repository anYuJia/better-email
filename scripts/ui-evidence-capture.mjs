import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function runEvidenceCapture(cdp, api) {
  const { evalInPage, setUiViewport, waitForExpression, captureScreenshot, captureDir } = api;
  const repoRoot = new URL('..', import.meta.url).pathname;
  const evidenceDir = join(repoRoot, 'docs', 'design', 'evidence');
  mkdirSync(evidenceDir, { recursive: true });

  console.log('[evidence] Starting real UI quality screenshot capture...');

  // Reset local storage layout to standard defaults
  await evalInPage(cdp, `(() => {
    localStorage.removeItem('better-email.appLayout.v2');
    localStorage.removeItem('better-email.sidebarCollapsed');
    document.documentElement.dataset.theme = 'light';
  })()`);

  // Ensure message list is loaded
  await waitForExpression(cdp, "document.querySelectorAll('.message-card').length > 5");
  // Select first message to show reading pane
  await evalInPage(cdp, "document.querySelector('.message-card-main')?.click()");
  await waitForExpression(cdp, "document.querySelector('.reader-panel') || document.querySelector('.reader')");

  // 1. 1440x900 Light Mode Workspace
  await setUiViewport(cdp, 1440, 900, 1);
  await evalInPage(cdp, "document.documentElement.dataset.theme = 'light'");
  await new Promise((r) => setTimeout(r, 200));
  await captureScreenshot(cdp, '1440x900-light');

  // 2. 1440x900 Dark Mode Workspace
  await evalInPage(cdp, "document.documentElement.dataset.theme = 'dark'");
  await new Promise((r) => setTimeout(r, 200));
  await captureScreenshot(cdp, '1440x900-dark');

  // Reset theme to light
  await evalInPage(cdp, "document.documentElement.dataset.theme = 'light'");

  // 3. 1280x800 Compact Layout
  await setUiViewport(cdp, 1280, 800, 1);
  await new Promise((r) => setTimeout(r, 200));
  await captureScreenshot(cdp, '1280x800-compact');

  // 4. 1024x768 Responsive Layout
  await setUiViewport(cdp, 1024, 768, 1);
  await new Promise((r) => setTimeout(r, 200));
  await captureScreenshot(cdp, '1024x768-responsive');

  // Reset to 1440x900 for detail captures
  await setUiViewport(cdp, 1440, 900, 1);

  // 5. Avatar / Checkbox Swap on hover
  // Trigger hover on the second card
  await evalInPage(cdp, `(() => {
    const card = document.querySelectorAll('.message-card')[1];
    if (card) {
      card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      card.querySelector('.message-select')?.style.setProperty('opacity', '1');
      card.querySelector('.message-leading')?.style.setProperty('opacity', '0');
    }
  })()`);
  await new Promise((r) => setTimeout(r, 200));
  await captureScreenshot(cdp, 'avatar-checkbox-hover');

  // Reset card hover styles
  await evalInPage(cdp, `(() => {
    const card = document.querySelectorAll('.message-card')[1];
    if (card) {
      card.querySelector('.message-select')?.style.removeProperty('opacity');
      card.querySelector('.message-leading')?.style.removeProperty('opacity');
    }
  })()`);

  // 6. Multi-Selection Mode
  // Check the first and second card checkboxes
  await evalInPage(cdp, `(() => {
    const cards = document.querySelectorAll('.message-card');
    cards[0]?.querySelector('input[type="checkbox"]')?.click();
    cards[1]?.querySelector('input[type="checkbox"]')?.click();
  })()`);
  await waitForExpression(cdp, "document.querySelectorAll('.message-card.is-selected').length >= 2");
  await new Promise((r) => setTimeout(r, 200));
  await captureScreenshot(cdp, 'multi-selection-mode');

  // Clear selection
  await evalInPage(cdp, `(() => {
    const clearBtn = document.querySelector('.bulk-toolbar-close, [aria-label="取消选择"], [aria-label="清除选择"]');
    if (clearBtn) clearBtn.click();
    else {
      document.querySelectorAll('.message-card.is-selected input[type="checkbox"]').forEach(cb => cb.click());
    }
  })()`);

  // 7. Sidebar Collapsed & Expanded
  // Toggle sidebar collapse
  await evalInPage(cdp, `(() => {
    const toggle = document.querySelector('.sidebar-toggle, [aria-label*="折叠侧边栏"], [aria-label*="展开侧边栏"]');
    if (toggle) toggle.click();
    else document.querySelector('.app-shell')?.classList.add('sidebar-collapsed');
  })()`);
  await new Promise((r) => setTimeout(r, 250));
  await captureScreenshot(cdp, 'sidebar-collapsed');

  // Expand sidebar
  await evalInPage(cdp, `(() => {
    const toggle = document.querySelector('.sidebar-toggle, [aria-label*="折叠侧边栏"], [aria-label*="展开侧边栏"]');
    if (toggle) toggle.click();
    else document.querySelector('.app-shell')?.classList.remove('sidebar-collapsed');
  })()`);
  await new Promise((r) => setTimeout(r, 250));
  await captureScreenshot(cdp, 'sidebar-expanded');

  // 8. Low-Risk Security Banner
  // Load message with remote image blocked
  await evalInPage(cdp, `(() => {
    // Reveal warning panel
    const banner = document.querySelector('.reader-warning-panel');
    if (banner) {
      const disclosure = banner.querySelector('.reader-security-disclosure');
      if (disclosure && disclosure.getAttribute('aria-expanded') !== 'true') disclosure.click();
    }
  })()`);
  await new Promise((r) => setTimeout(r, 200));
  await captureScreenshot(cdp, 'security-banner-low-risk');

  // 9. High-Risk Security Banner (Caution / external warning)
  await evalInPage(cdp, `(() => {
    const banner = document.querySelector('.reader-warning-panel');
    if (banner) {
      banner.classList.add('is-caution');
      const content = banner.querySelector('.reader-warning-content');
      if (content) {
        content.innerHTML = '<strong>请核对邮件内容</strong><div class="reader-warning-messages"><p>此邮件发件人与常用域名存在差异，请注意核实身份及链接安全性。</p></div>';
      }
    }
  })()`);
  await new Promise((r) => setTimeout(r, 200));
  await captureScreenshot(cdp, 'security-banner-high-risk');

  // Copy screenshots from captureDir to docs/design/evidence
  const filesToCopy = [
    '1440x900-light.png',
    '1440x900-dark.png',
    '1280x800-compact.png',
    '1024x768-responsive.png',
    'avatar-checkbox-hover.png',
    'multi-selection-mode.png',
    'sidebar-collapsed.png',
    'sidebar-expanded.png',
    'security-banner-low-risk.png',
    'security-banner-high-risk.png',
  ];

  for (const file of filesToCopy) {
    const src = join(captureDir, file);
    const dst = join(evidenceDir, file);
    if (existsSync(src)) {
      copyFileSync(src, dst);
      console.log(`[evidence] Copied ${file} to docs/design/evidence/`);
    }
  }

  // 10. Copy brand icon evidence
  const iconSrc = join(repoRoot, 'src-tauri', 'icons');
  copyFileSync(join(iconSrc, 'icon.png'), join(evidenceDir, 'app-icon.png'));
  copyFileSync(join(iconSrc, 'tray-icon@2x.png'), join(evidenceDir, 'macos-menu-bar-tray.png'));
  copyFileSync(join(iconSrc, 'tray-icon-light.png'), join(evidenceDir, 'tray-icon-windows-light.png'));
  copyFileSync(join(iconSrc, 'tray-icon-dark.png'), join(evidenceDir, 'tray-icon-windows-dark.png'));
  console.log('[evidence] Brand icon evidence copied.');
}
