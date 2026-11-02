import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Real application interactions in the isolated mock browser. No provider sends.
export async function runWorkflowQuality(cdp, api) {
  const { evalInPage, setUiViewport, waitForExpression, captureScreenshot, clickButton, fillInput, closeComposer, url, captureDir } = api;
  const cases = [[1440, 900], [1280, 800], [1024, 768], [390, 844], [393, 852], [430, 932]]
    .flatMap(([w, h]) => ['light', 'dark'].map(theme => ({ w, h, theme, scale: 1 })));
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const scale of [1.25, 1.5]) cases.push({ w, h, theme: 'light', scale });
  }
  cases.push({ w: 1024, h: 320, theme: 'light', scale: 1.5 });
  const results = [];
  const key = async (name, code) => {
    for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code });
  };
  const scaleText = async scale => {
    if (scale === 1) return;
    await evalInPage(cdp, `(() => {
      const sizes = [...document.querySelectorAll('body *')].map(el => [el, el.dataset.qaFontBase || getComputedStyle(el).fontSize]);
      for (const [el, size] of sizes) { el.dataset.qaFontBase = size; el.style.fontSize = parseFloat(size) * ${scale} + 'px'; }
    })()`);
  };
  for (const item of cases) {
    const { w, h, theme, scale } = item;
    const mobile = w <= 720;
    const label = `${w}x${h}-${theme}-${scale * 100}`;
    await setUiViewport(cdp, w, h);
    await evalInPage(cdp, `localStorage.clear(); localStorage.setItem('better-email.theme-mode', '${theme}'); history.replaceState({}, '', ${JSON.stringify(url)}); location.reload()`);
    await waitForExpression(cdp, "document.querySelector('.message-card-main')");
    if (mobile) await clickButton(cdp, '搜索邮件', "document.querySelector('.mobile-inbox-header')");
    const input = mobile ? '.mobile-search-form input' : '.global-search-box input';
    await evalInPage(cdp, `document.querySelector('${input}').focus()`);
    await cdp.send('Input.insertText', { text: '项目资料 ProjectReport' });
    await scaleText(scale);
    if (!mobile) {
      await waitForExpression(cdp, "document.querySelector('.search-suggestion-panel')");
      await key('Home', 36);
      const nativeHome = await evalInPage(cdp, `(() => { const input = document.querySelector('${input}'); return input.selectionStart === 0 && !input.hasAttribute('aria-activedescendant'); })()`);
      if (!nativeHome) throw new Error(`Search Home intercepted: ${label}`);
      await key('ArrowDown', 40);
      await key('End', 35);
      const geometry = await evalInPage(cdp, `(() => {
        const panel = document.querySelector('.search-suggestion-panel');
        const selected = panel.querySelector('[aria-selected="true"]');
        const p = panel.getBoundingClientRect(), s = selected.getBoundingClientRect();
        return { selected: selected.textContent.trim(), selectedCount: panel.querySelectorAll('.active').length,
          fits: p.top >= 0 && p.bottom <= innerHeight && p.left >= 0 && p.right <= innerWidth,
          selectedVisible: s.top >= p.top && s.bottom <= p.bottom + 1,
          scrollTop: panel.scrollTop, partialCountsHidden: !panel.textContent.includes('0 封') };
      })()`);
      if (!geometry.fits || !geometry.selectedVisible || geometry.selectedCount !== 1 || !geometry.partialCountsHidden || geometry.selected !== '星标') {
        throw new Error(`Search suggestion geometry: ${label}: ${JSON.stringify(geometry)}`);
      }
      await captureScreenshot(cdp, `workflow-${label}-search`);
      results.push({ ...item, surface: 'search', nativeHome, ...geometry });
      await key('Enter', 13);
      await waitForExpression(cdp, `document.querySelector('${input}').value === 'is:starred 项目资料 ProjectReport' && !document.querySelector('.search-suggestion-panel') && !document.querySelector('${input}').hasAttribute('aria-activedescendant')`);
    } else {
      await captureScreenshot(cdp, `workflow-${label}-search`);
    }
    const clear = mobile ? '.mobile-search-clear' : '.search-clear-button';
    await evalInPage(cdp, `document.querySelector('${clear}').focus(); document.querySelector('${clear}').click()`);
    await waitForExpression(cdp, `document.activeElement === document.querySelector('${input}') && document.querySelector('${input}').value === ''`);
    if (mobile) {
      await key('Escape', 27);
      await waitForExpression(cdp, "!document.querySelector('.mobile-search-form') && document.activeElement === document.querySelector('.mobile-inbox-header [aria-label=\"搜索邮件\"]')");
      results.push({ ...item, surface: 'mobile-search', clearFocus: true, closeFocus: true });
    }
    if (h < 600) continue;
    await clickButton(cdp, '写邮件', mobile ? "document.querySelector('.mobile-bottom-nav')" : "document.querySelector('.sidebar')");
    await waitForExpression(cdp, "document.querySelector('.composer')");
    await clickButton(cdp, '更多写信工具', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.querySelector('.composer-more-menu')");
    await clickButton(cdp, '保存并关闭', "document.querySelector('.composer-more-menu')");
    await waitForExpression(cdp, "document.querySelector('.composer-more-menu .composer-save-feedback')");
    if (!await evalInPage(cdp, "!!document.querySelector('.composer') && !window.__betterEmailMockInvocations.some(call => call.command === 'save_draft')")) {
      throw new Error(`Empty save unexpectedly persisted or closed: ${label}`);
    }
    await clickButton(cdp, '插入模板…', "document.querySelector('.composer-more-menu')");
    await clickButton(cdp, '保存为模板…', "document.querySelector('.composer-advanced-popover')");
    await fillInput(cdp, '.composer-template-save-dialog input', '项目汇报与 Project Report 模板');
    await clickButton(cdp, '保存', "document.querySelector('.composer-template-save-dialog')");
    await waitForExpression(cdp, "document.querySelector('.composer-template-save-dialog [role=alert]') && document.activeElement === document.querySelector('.composer-template-save-dialog input')");
    await scaleText(scale);
    await captureScreenshot(cdp, `workflow-${label}-template-validation`);
    const templateBounds = await evalInPage(cdp, `(() => {
      const panel = document.querySelector('.composer-advanced-popover'); const p = panel.getBoundingClientRect();
      return { fits: p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight,
        textFits: panel.scrollWidth <= panel.clientWidth + 1,
        touchTargets: [...panel.querySelectorAll('button, input')].every(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }),
        duplicateToasts: document.querySelectorAll('.message-toast').length,
        namePreserved: panel.querySelector('input').value === '项目汇报与 Project Report 模板' };
    })()`);
    if (!templateBounds.fits || !templateBounds.textFits || !templateBounds.namePreserved || templateBounds.duplicateToasts || (mobile && !templateBounds.touchTargets)) throw new Error(`Template validation layout: ${label}: ${JSON.stringify(templateBounds)}`);
    results.push({ ...item, surface: 'template-validation', ...templateBounds });
    await key('Escape', 27);
    await key('Escape', 27);
    await waitForExpression(cdp, "!document.querySelector('.composer-advanced-popover')");
    await fillInput(cdp, '.composer input[aria-label="主题"]', '保存失败后仍然可以继续编辑');
    await evalInPage(cdp, `window.__betterEmailMockCommandOverride = async command => {
      if (command === 'save_draft') throw new Error('暂时无法写入草稿，请重试');
      return null;
    }`);
    await clickButton(cdp, '更多写信工具', "document.querySelector('.composer')");
    await clickButton(cdp, '保存并关闭', "document.querySelector('.composer-more-menu')");
    await waitForExpression(cdp, "document.querySelector('.composer-more-menu [role=alert]') && document.querySelector('.composer input[aria-label=\"主题\"]').value === '保存失败后仍然可以继续编辑'");
    await scaleText(scale);
    await captureScreenshot(cdp, `workflow-${label}-save-failure`);
    const saveBounds = await evalInPage(cdp, `(() => {
      const panel = document.querySelector('.composer-advanced-popover'); const p = panel.getBoundingClientRect();
      const button = [...panel.querySelectorAll('button')].find(b => b.textContent === '保存并关闭');
      return { fits: p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight,
        textFits: panel.scrollWidth <= panel.clientWidth + 1, retryEnabled: !button.disabled,
        duplicateToasts: document.querySelectorAll('.message-toast').length };
    })()`);
    if (!saveBounds.fits || !saveBounds.textFits || !saveBounds.retryEnabled || saveBounds.duplicateToasts) throw new Error(`Save failure layout: ${label}: ${JSON.stringify(saveBounds)}`);
    results.push({ ...item, surface: 'save-failure', ...saveBounds });
    await evalInPage(cdp, 'window.__betterEmailMockCommandOverride = null');
    await key('Escape', 27);
    await closeComposer(cdp);
    if (mobile || (theme === 'light' && scale === 1 && w === 1440)) {
      await clickButton(cdp, '写邮件', mobile ? "document.querySelector('.mobile-bottom-nav')" : "document.querySelector('.sidebar')");
      await waitForExpression(cdp, "document.querySelector('.composer-body-field')");
      await evalInPage(cdp, `(() => {
        window.__betterEmailMockCommandOverride = async command => command === 'save_temp_attachment'
          ? new Promise((resolve, reject) => { window.__failPendingAttachment = () => reject(new Error('附件准备失败测试')); }) : null;
        const data = new DataTransfer(); data.items.add(new File(['test'], '待导入附件.pdf', { type: 'application/pdf' }));
        document.querySelector('.composer-body-field').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
      })()`);
      await waitForExpression(cdp, "typeof window.__failPendingAttachment === 'function' && document.querySelector('[data-import-state=preparing]')");
      await evalInPage(cdp, "document.querySelector('.composer-contact-toggle').click()");
      await scaleText(scale);
      await waitForExpression(cdp, "document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity)");
      const contactsGeometry = await evalInPage(cdp, `(() => {
        const panel = document.querySelector('.composer-contacts-panel'), p = panel.getBoundingClientRect();
        const targets = [...panel.querySelectorAll('button, input')].map(el => { const r = el.getBoundingClientRect(); return { name: el.getAttribute('aria-label') || el.textContent.trim(), w: r.width, h: r.height }; });
        return { fullWidth: Math.abs(p.left) < 1 && Math.abs(p.right - innerWidth) < 1,
          fits: panel.scrollWidth <= panel.clientWidth + 1 && p.top >= -1 && p.bottom <= innerHeight + 1,
          bounds: { x: p.left, y: p.top, bottom: p.bottom, width: p.width, scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth },
          targets, touchTargets: targets.every(r => r.w >= 44 && r.h >= 44) };
      })()`);
      if (!contactsGeometry.fits || (mobile && (!contactsGeometry.fullWidth || !contactsGeometry.touchTargets))) throw new Error(`Contacts layout: ${label}: ${JSON.stringify(contactsGeometry)}`);
      await clickButton(cdp, '管理联系人', "document.querySelector('.composer-contacts-panel')");
      await waitForExpression(cdp, "document.querySelector('[data-import-state=preparing]') && document.querySelector('.composer-contacts-panel') && !document.querySelector('.settings-page')");
      await evalInPage(cdp, 'window.__failPendingAttachment()');
      await waitForExpression(cdp, "document.querySelector('[data-import-state=failed]')");
      await clickButton(cdp, '管理联系人', "document.querySelector('.composer-contacts-panel')");
      await waitForExpression(cdp, "document.querySelector('[data-import-state=failed]') && document.querySelector('.composer-contacts-panel') && !document.querySelector('.settings-page')");
      await captureScreenshot(cdp, `workflow-${label}-contacts-preserve-attachment`);
      results.push({ ...item, surface: 'contacts-preserve-attachment', pendingPreserved: true, failurePreserved: true, ...contactsGeometry });
      if (mobile) await clickButton(cdp, '返回写信', "document.querySelector('.composer-contacts-panel')");
      else await evalInPage(cdp, "document.querySelector('.composer-contact-toggle').click()");
      await evalInPage(cdp, 'window.__betterEmailMockCommandOverride = null');
      await closeComposer(cdp);
    }
  }
  writeFileSync(join(captureDir, 'workflow-report.json'), JSON.stringify({ status: 'ok', scenarios: results.length, results }, null, 2));
  console.log(JSON.stringify({ status: 'ok', workflowScenarios: results.length, captureDir }, null, 2));
}
