import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Runs in the same isolated mock profile as the functional UI smoke. Text
// scaling deliberately changes computed font sizes, not viewport screenshots.
export async function runQualityMatrix(cdp, api) {
  const { evalInPage, setUiViewport, waitForExpression, captureScreenshot, clickButton, fillInput, closeComposer, openSettingsSection, url, captureDir } = api;
  const cases = [[1440, 900], [1280, 800], [1180, 760], [1024, 768], [390, 844], [393, 852], [430, 932]]
    .flatMap(([w, h]) => ['light', 'dark'].map((theme) => ({ w, h, theme, scale: 1 })));
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const scale of [1.25, 1.5]) cases.push({ w, h, theme: 'light', scale });
  }
  if (process.env.BETTER_EMAIL_UI_QUALITY_CONTENT_ONLY === '1') cases.length = 0;
  const results = [];
  for (const item of cases) {
    const { w, h, theme, scale } = item;
    const mobile = w <= 720;
    const label = `${w}x${h}-${theme}-${scale * 100}`;
    await setUiViewport(cdp, w, h);
    await evalInPage(cdp, `localStorage.setItem('better-email.theme-mode', '${theme}'); history.replaceState({}, '', ${JSON.stringify(url)}); location.reload()`);
    await waitForExpression(cdp, "document.querySelector('.message-card-main') && document.querySelector('.reader h1, .mobile-inbox-title')");
    const check = async (surface) => {
      if (scale !== 1) await evalInPage(cdp, `(() => {
        const elements = [...document.querySelectorAll('body *')];
        const sizes = elements.map((element) => [element, element.dataset.qaFontBase || getComputedStyle(element).fontSize]);
        for (const [element, size] of sizes) { element.dataset.qaFontBase = size; element.style.fontSize = parseFloat(size) * ${scale} + 'px'; }
      })()`);
      await waitForExpression(cdp, "document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity)");
      if (surface === 'threads') await waitForExpression(cdp, "[...document.querySelectorAll('.thread-list-item')].every(el => el.firstElementChild.getBoundingClientRect().height <= el.getBoundingClientRect().height + 1)");
      const geometry = await evalInPage(cdp, `(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const search = rect('.global-search-box input');
        const editor = rect('.composer-editor-pane');
        const row = rect('.message-card');
        const summary = rect('.message-card .message-bottomline');
        const compose = rect('.mobile-bottom-compose');
        const composeIcon = rect('.mobile-bottom-compose-icon');
        const composeLabel = rect('.mobile-bottom-compose > span:last-child');
        const settings = rect('.settings-shell');
        const folderTitle = rect('.list-folder-title');
        const readerPane = rect('.reader-panel');
        const recipientInput = rect('.composer-recipient-editor input');
        const recipientDetails = rect('.composer-recipient-details-toggle');
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
          folderTitleVisible: !!folderTitle && folderTitle.width > 0 && folderTitle.height > 0,
          readerPaneWidth: readerPane?.width ?? null,
          recipientInputWidth: recipientInput?.width ?? null,
          recipientDetailsTouchTarget: !recipientDetails || (recipientDetails.width >= 44 && recipientDetails.height >= 44),
          searchWidth: search?.width ?? null, editorWidth: editor?.width ?? null,
          rowContentClipped: row && summary ? summary.bottom > row.bottom + 1 : false,
          threadContentClipped: [...document.querySelectorAll('.thread-preview')].some(el =>
            el.clientHeight + 1 < parseFloat(getComputedStyle(el).lineHeight)),
          threadRowsOverlap: [...document.querySelectorAll('.thread-list-item')].some(el =>
            el.firstElementChild.getBoundingClientRect().height > el.getBoundingClientRect().height + 1),
          threadUnreadOverlapsSender: [...document.querySelectorAll('.thread-unread-dot')].some(el => {
            const dot = el.getBoundingClientRect();
            const sender = el.closest('.thread-card')?.querySelector('.thread-sender')?.getBoundingClientRect();
            return sender && dot.right > sender.left && dot.left < sender.right
              && dot.bottom > sender.top && dot.top < sender.bottom;
          }),
          selectionTouchTargets: [...document.querySelectorAll('.mobile-selection-toolbar button, .mobile-selection-toolbar summary, .mobile-selection-toolbar .message-selection-all')]
            .filter(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility === 'visible')
            .every(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }),
          refinementTouchTargets: [...document.querySelectorAll('.mobile-inbox-refinements button')]
            .every(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }),
          composeActionFits: !compose || compose.width === 0 || (compose.height >= 44
            && compose.left >= 0 && compose.right <= innerWidth && compose.bottom <= innerHeight
            && composeIcon.right <= composeLabel.left
            && Math.abs(composeIcon.top + composeIcon.height / 2 - composeLabel.top - composeLabel.height / 2) <= 1),
          settingsFillsViewport: !settings || (Math.abs(settings.left) <= 1 && Math.abs(settings.top) <= 1
            && Math.abs(settings.width - innerWidth) <= 1 && Math.abs(settings.height - innerHeight) <= 1),
          visibleModal: [...document.querySelectorAll('[aria-modal="true"]')].filter((el) => el.getBoundingClientRect().width > 0).length };
      })()`);
      if (geometry.overflow) throw new Error(`Horizontal overflow: ${label}/${surface}`);
      if (surface === 'inbox' && geometry.rowContentClipped) throw new Error(`Message summary clipped: ${label}`);
      if (surface === 'threads' && (geometry.threadContentClipped || geometry.threadRowsOverlap || geometry.threadUnreadOverlapsSender)) throw new Error(`Conversation geometry: ${label}: ${JSON.stringify(geometry)}`);
      if (surface.startsWith('selection') && !geometry.selectionTouchTargets) throw new Error(`Selection touch targets: ${label}`);
      if (surface === 'search-retained' && !geometry.refinementTouchTargets) throw new Error(`Refinement touch targets: ${label}`);
      if (surface === 'inbox' && mobile && !geometry.composeActionFits) throw new Error(`Mobile compose action layout: ${label}`);
      if (surface.startsWith('settings') && !geometry.settingsFillsViewport) throw new Error(`Settings surface bounds: ${label}`);
      if (surface === 'inbox' && !mobile && geometry.searchWidth !== null && geometry.searchWidth < 160) throw new Error(`Cold search collapsed: ${label}`);
      if (surface === 'composer' && !mobile && geometry.editorWidth < 560) throw new Error(`Composer editor compressed: ${label}`);
      results.push({ ...item, surface, ...geometry });
      await captureScreenshot(cdp, `quality-${label}-${surface}`);
    };
    const checkLabels = async () => {
      await evalInPage(cdp, "document.querySelector('.label-menu > summary').click()");
      await waitForExpression(cdp, "document.querySelector('.label-menu[data-menu-positioned=\"true\"]')");
      await evalInPage(cdp, "document.querySelector('.label-menu-add-section input').focus()");
      for (const character of '标签输入核对') await cdp.send('Input.insertText', { text: character });
      const labelInputFocused = await evalInPage(cdp, "document.activeElement === document.querySelector('.label-menu-add-section input')");
      if (!labelInputFocused) throw new Error(`Label input lost focus while typing: ${label}`);
      await evalInPage(cdp, "document.querySelector('.label-select-btn').focus()");
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await check('labels');
      const labelGeometry = await evalInPage(cdp, `(() => {
        const panel = document.querySelector('.label-menu-container'); const r = panel.getBoundingClientRect();
        const dots = [...panel.querySelectorAll('.color-dot-btn')].map(e => e.getBoundingClientRect());
        const actions = panel.querySelector('.label-item-actions');
        return { fits: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
          paletteRows: new Set(dots.map(r => Math.round(r.top))).size,
          targetSize: Math.min(...dots.map(r => Math.min(r.width, r.height))),
          keyboardActionVisible: actions.contains(document.activeElement) && getComputedStyle(actions).opacity === '1' };
      })()`);
      if (!labelGeometry.fits || labelGeometry.paletteRows > (mobile ? 2 : 1)
        || labelGeometry.targetSize < (mobile ? 44 : 24) || !labelGeometry.keyboardActionVisible) {
        throw new Error(`Label menu layout/focus: ${label}: ${JSON.stringify(labelGeometry)}`);
      }
      await evalInPage(cdp, "document.querySelector('.label-menu > summary').click()");
      await waitForExpression(cdp, "!document.querySelector('.label-menu[open]') && !document.querySelector('[data-transient-exit]')");
    };
    await check('inbox');
    const inboxGeometry = results[results.length - 1];
    if (!mobile && (!inboxGeometry.folderTitleVisible || (w > 1180 && inboxGeometry.readerPaneWidth < 559))) {
      throw new Error(`Mailbox context or reading space: ${label}: ${JSON.stringify(inboxGeometry)}`);
    }
    if (!mobile && w === 1280) {
      await evalInPage(cdp, "document.querySelector('.filter-menu > summary').click()");
      await waitForExpression(cdp, "document.querySelector('.filter-menu[open] [role=menu]')");
      await clickButton(cdp, '附件', "document.querySelector('.filter-menu')");
      await waitForExpression(cdp, "document.querySelector('.list-clear-filter') && !document.querySelector('.search-clear-button') && document.querySelectorAll('.message-card').length === 1");
      await check('active-filter');
      await clickButton(cdp, '清除筛选：附件', "document.querySelector('.list-summary')");
      await waitForExpression(cdp, "!document.querySelector('.list-clear-filter') && document.querySelectorAll('.message-card').length > 1");
    }
    const changeListMode = async (mode) => {
      if (mobile) {
        await evalInPage(cdp, "document.querySelector('.mobile-filter-trigger').click()");
        await waitForExpression(cdp, "document.querySelector('[role=\"menu\"][aria-label=\"邮件筛选和列表模式\"]')");
        await clickButton(cdp, mode === 'threads' ? '会话列表' : '邮件列表', "document.querySelector('[role=\"menu\"][aria-label=\"邮件筛选和列表模式\"]')");
      } else await clickButton(cdp, mode === 'threads' ? '会话' : '邮件', "document.querySelector('.list-control-tabs')");
      await waitForExpression(cdp, mode === 'threads' ? "document.querySelector('.thread-card')" : "document.querySelector('.message-card-main')");
    };
    await changeListMode('threads');
    await check('threads');
    await changeListMode('messages');
    if (!mobile) await checkLabels();
    if (mobile) {
      await evalInPage(cdp, "document.querySelector('.mobile-filter-trigger').click()");
      await waitForExpression(cdp, "document.querySelector('[role=\"menu\"][aria-label=\"邮件筛选和列表模式\"]')");
      await clickButton(cdp, '选择邮件', "document.querySelector('[role=\"menu\"][aria-label=\"邮件筛选和列表模式\"]')");
      await waitForExpression(cdp, "document.querySelector('.mobile-selection-toolbar') && document.querySelector('.message-card.is-selection-mode')");
      await check('selection-empty');
      await evalInPage(cdp, "document.querySelector('.message-card-main').click()");
      await waitForExpression(cdp, "document.querySelector('.mobile-selection-toolbar .bulk-toolbar') && !document.querySelector('.mobile-reader-surface')");
      await check('selection-active');
      await clickButton(cdp, '退出选择', "document.querySelector('.mobile-inbox-header')");
      await waitForExpression(cdp, "!document.querySelector('.mobile-selection-toolbar') && !document.querySelector('.message-select input:checked')");
      await evalInPage(cdp, "document.querySelector('.mobile-filter-trigger').click()");
      await waitForExpression(cdp, "document.querySelector('[role=\"menu\"][aria-label=\"邮件筛选和列表模式\"]')");
      await clickButton(cdp, '附件', "document.querySelector('[role=\"menu\"][aria-label=\"邮件筛选和列表模式\"]')");
      await waitForExpression(cdp, "document.querySelector('.mobile-clear-filter') && document.querySelectorAll('.message-card').length === 1");
      await clickButton(cdp, '搜索邮件', "document.querySelector('.mobile-inbox-header')");
      await fillInput(cdp, '.mobile-search-form input', 'Security');
      await evalInPage(cdp, "document.querySelector('.mobile-search-form').requestSubmit()");
      await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('已搜索：Security') && document.querySelectorAll('.message-card').length === 1");
      await clickButton(cdp, '关闭搜索', "document.querySelector('.mobile-inbox-header')");
      await waitForExpression(cdp, "document.querySelector('.mobile-active-search-query')?.textContent.includes('Security')");
      await check('search-retained');
      await clickButton(cdp, '清除当前搜索', "document.querySelector('.mobile-inbox-header')");
      await waitForExpression(cdp, "!document.querySelector('.mobile-active-search') && document.querySelector('.mobile-clear-filter') && document.querySelectorAll('.message-card').length === 1");
      await clickButton(cdp, '清除筛选：附件', "document.querySelector('.mobile-inbox-header')");
      await waitForExpression(cdp, "!document.querySelector('.mobile-inbox-refinements') && document.querySelectorAll('.message-card').length > 1");
      await evalInPage(cdp, "document.querySelector('.message-card-main').click()");
      await waitForExpression(cdp, "document.querySelector('.mobile-screen-layer--reader.is-active .reader h1')");
      await waitForExpression(cdp, "document.querySelector('.quick-reply-entry') && !document.querySelector('.quick-reply textarea')");
      await check('reader');
      await checkLabels();
      await clickButton(cdp, '开始快速回复', "document.querySelector('.quick-reply')");
      await waitForExpression(cdp, "document.activeElement === document.querySelector('.quick-reply textarea') && !document.querySelector('.composer')");
      await fillInput(cdp, '.quick-reply textarea', '切换阅读后继续这份回复');
      await check('reader-reply');
      await waitForExpression(cdp, `(() => {
        const input = document.querySelector('.quick-reply textarea')?.getBoundingClientRect();
        const toolbar = document.querySelector('.reader-actions')?.getBoundingClientRect();
        return input && toolbar && input.top >= 0 && input.bottom <= toolbar.top;
      })()`);
      await evalInPage(cdp, "document.querySelector('[data-narrow-reader-back]').click()");
      await waitForExpression(cdp, "!document.querySelector('.mobile-reader-surface')");
      await evalInPage(cdp, "document.querySelector('.message-card-main').click()");
      await waitForExpression(cdp, "document.querySelector('.quick-reply textarea')?.value === '切换阅读后继续这份回复' && !document.querySelector('.quick-reply-entry')");
      await clickButton(cdp, '回复', "document.querySelector('.reader-response-actions')");
      await waitForExpression(cdp, "document.activeElement === document.querySelector('.quick-reply textarea') && !document.querySelector('.composer')");
      await fillInput(cdp, '.quick-reply textarea', '');
      await waitForExpression(cdp, "document.querySelector('.quick-reply textarea')?.value === ''");
      await evalInPage(cdp, "document.querySelector('[data-narrow-reader-back]').click()");
      await waitForExpression(cdp, "!document.querySelector('.mobile-reader-surface')");
    }
    await clickButton(cdp, '写邮件', mobile ? "document.querySelector('.mobile-bottom-nav')" : "document.querySelector('.sidebar')");
    await waitForExpression(cdp, "document.querySelector('.composer-editor-pane')");
    await check('composer');
    const composerGeometry = results[results.length - 1];
    if (mobile && (composerGeometry.recipientInputWidth < 48 || !composerGeometry.recipientDetailsTouchTarget)) {
      throw new Error(`Mobile recipient entry: ${label}: ${JSON.stringify(composerGeometry)}`);
    }
    await fillInput(cdp, '.composer input[aria-label="主题"]', '关闭确认保留草稿');
    await clickButton(cdp, '关闭写信窗口', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.querySelector('.composer-close-dialog')");
    await check('close-confirmation');
    const confirmation = await evalInPage(cdp, `(() => {
      const dialog = document.querySelector('.composer-close-dialog');
      const bounds = dialog.getBoundingClientRect();
      const controls = [...dialog.querySelectorAll('button')];
      return { focusedSafeAction: document.activeElement?.textContent.trim() === '继续编辑',
        activeElement: { tag: document.activeElement?.tagName ?? null,
          class: document.activeElement?.getAttribute('class') ?? null,
          text: document.activeElement?.textContent?.trim().slice(0, 160) ?? null },
        documentHasFocus: document.hasFocus(),
        controlsFit: controls.every(button => { const r = button.getBoundingClientRect(); return r.left >= bounds.left && r.right <= bounds.right + 1 && button.scrollWidth <= button.clientWidth + 1; }),
        touchTargets: controls.every(button => button.getBoundingClientRect().height >= 44) };
    })()`);
    if (!confirmation.focusedSafeAction || !confirmation.controlsFit || (mobile && !confirmation.touchTargets)) {
      throw new Error(`Close confirmation controls/focus: ${label}: ${JSON.stringify(confirmation)}`);
    }
    await clickButton(cdp, '继续编辑', "document.querySelector('.composer-close-dialog')");
    await waitForExpression(cdp, "!document.querySelector('.composer-close-dialog') && document.querySelector('.composer input[aria-label=\"主题\"]')?.value === '关闭确认保留草稿'");
    await closeComposer(cdp);
    if (mobile) {
      await evalInPage(cdp, "document.querySelector('[aria-label=\"打开邮箱导航\"]').click()");
      await waitForExpression(cdp, "document.querySelector('.mobile-mailbox-sheet')");
      await clickButton(cdp, '设置', "document.querySelector('.mobile-mailbox-footer')");
      await waitForExpression(cdp, "document.querySelector('.mobile-settings-root') && !document.querySelector('.mobile-mailbox-sheet') && !document.querySelector('.settings-modal')");
      await check('settings-root');
      await evalInPage(cdp, "document.querySelector('.mobile-settings-row').click()");
      await waitForExpression(cdp, "document.querySelector('.settings-page')");
    } else {
      await clickButton(cdp, '设置', "document.querySelector('.sidebar-footer, .narrow-navigation')");
      await waitForExpression(cdp, "document.querySelector('.settings-page')");
      await check('settings-root');
      await openSettingsSection(cdp, '通用', 'general', '.settings-page[data-settings-page="general"]');
    }
    await check('settings-detail');
  }
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    await setUiViewport(cdp, w, h);
    await evalInPage(cdp, `history.replaceState({}, '', ${JSON.stringify(url)}); location.reload()`);
    await waitForExpression(cdp, "document.querySelector('.message-card-main')");
    for (const [index, scenario] of ['long-text', 'empty-body', 'large-body'].entries()) {
      await waitForExpression(cdp, "!document.querySelector('.titlebar-refresh[aria-busy=\"true\"], .mobile-inbox-sync-bar .animate-spin')");
      if (index === 0) await evalInPage(cdp, `(async () => {
        const state = await import('/src/mockTauri/state.ts');
        const source = state.messages[0];
        for (const [fixtureIndex, scenario] of ['long-text', 'empty-body', 'large-body'].entries()) {
        state.messages.unshift({ ...source, id: 99000 + fixtureIndex, received_at: '2030-01-01T00:00:00Z',
          subject: scenario === 'long-text' ? '很长的中文邮件主题与EnglishSubject'.repeat(16) : scenario,
          sender_name: scenario === 'long-text' ? '很长的发件人名称'.repeat(12) : 'Quality Fixture',
          body: scenario === 'empty-body' ? '' : 'LongEnglishWordWithoutAnySpaces'.repeat(scenario === 'large-body' ? 10000 : 100),
          sanitized_html: '', attachment_count: 0, has_attachments: false, security_warnings: [], remote_uid: 0 });
        }
        // Refresh through the real application action; fixture data stays in
        // this isolated mock module and never reaches a real account.
        if (document.querySelector('[data-narrow-reader-back]')) document.querySelector('[data-narrow-reader-back]').click();
        await new Promise(resolve => setTimeout(resolve, 200));
        const refresh = document.querySelector('[aria-label="刷新邮件"]');
        if (refresh) refresh.click();
        else {
          // Mobile exposes refresh in its existing filter/list menu.
          document.querySelector('.mobile-filter-trigger')?.click();
          await new Promise(resolve => requestAnimationFrame(resolve));
          document.querySelector('[data-context-item="mobile-refresh"]')?.click();
        }
      })()`);
      if (w <= 720 && index > 0) {
        await evalInPage(cdp, "document.querySelector('[data-narrow-reader-back]').click()");
        await waitForExpression(cdp, "!document.querySelector('.mobile-reader-surface')");
      }
      await waitForExpression(cdp, `document.querySelector('.message-card[data-message-id="${99000 + index}"]')`, 5000);
      await evalInPage(cdp, `document.querySelector('.message-card[data-message-id="${99000 + index}"] .message-card-main').click()`);
      await waitForExpression(cdp, scenario === 'large-body'
        ? "[...document.querySelectorAll('.reader button')].some(button => button.textContent === '加载完整邮件')"
        : `document.querySelector('.reader h1')?.textContent === ${JSON.stringify(scenario === 'long-text' ? '很长的中文邮件主题与EnglishSubject'.repeat(16) : scenario)}`);
      await waitForExpression(cdp, "document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity)");
      const overflow = await evalInPage(cdp, `(() => {
        const panel = document.querySelector('.reader-panel');
        const overflowing = document.documentElement.scrollWidth > innerWidth + 1 || panel.scrollWidth > panel.clientWidth + 1;
        if (!overflowing) return null;
        const bounds = panel.getBoundingClientRect();
        return { documentWidth: document.documentElement.scrollWidth, panelWidth: panel.clientWidth, panelScroll: panel.scrollWidth,
          elements: [...panel.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > bounds.right + 1)
            .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
            .slice(0, 12).map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right })) };
      })()`);
      if (overflow) throw new Error(`Long/empty/large content overflow: ${w}/${scenario}: ${JSON.stringify(overflow)}`);
      await captureScreenshot(cdp, `quality-${w}x${h}-${scenario}`);
      if (scenario === 'long-text') {
        await waitForExpression(cdp, "document.querySelector('.quick-reply')");
        const savedOffset = await evalInPage(cdp, `(async () => {
          const panel = document.querySelector('.reader-panel');
          panel.scrollTop = Math.min(440, panel.scrollHeight - panel.clientHeight);
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return panel.scrollTop;
        })()`);
        if (savedOffset < 200) throw new Error(`Long reader fixture did not scroll: ${w}`);
        for (const id of [99001, 99000]) {
          if (w <= 720) {
            await evalInPage(cdp, "document.querySelector('[data-narrow-reader-back]').click()");
            await waitForExpression(cdp, "!document.querySelector('.mobile-reader-surface')");
          }
          await evalInPage(cdp, `document.querySelector('.message-card[data-message-id="${id}"] .message-card-main').click()`);
          await waitForExpression(cdp, id === 99001
            ? "document.querySelector('.reader h1')?.textContent === 'empty-body'"
            : "document.querySelector('.reader h1')?.textContent.startsWith('很长的中文') && document.querySelector('.quick-reply')");
          await waitForExpression(cdp, "document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity)");
          await waitForExpression(cdp, `Math.abs(document.querySelector('.reader-panel').scrollTop - ${id === 99001 ? 0 : savedOffset}) <= 1`);
        }
        await captureScreenshot(cdp, `quality-${w}x${h}-reading-position-restored`);
      }
      if (scenario === 'large-body') {
        await clickButton(cdp, '加载完整邮件', "document.querySelector('.reader')");
        await waitForExpression(cdp, "document.querySelector('.reader-plain-text, .body-text')");
        await waitForExpression(cdp, "document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity)");
        await captureScreenshot(cdp, `quality-${w}x${h}-large-body-expanded`);
      }
    }
  }
  await setUiViewport(cdp, 1440, 900);
  await evalInPage(cdp, `location.href = ${JSON.stringify(url)}`);
  await waitForExpression(cdp, "document.querySelectorAll('.message-card-main').length > 5 && document.querySelector('.reader h1')");
  const interactions = await evalInPage(cdp, `(async () => {
    const timings = [];
    const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (let index = 0; index < 24; index += 1) {
      const rows = document.querySelectorAll('.message-card-main');
      const target = rows[index % Math.min(rows.length, 6)];
      const start = performance.now(); target.click(); await nextPaint();
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    return { samples: timings.length, cachedSwitchPaintP50Ms: timings[Math.floor(timings.length * .5)], cachedSwitchPaintP95Ms: timings[Math.floor(timings.length * .95)], engine: navigator.userAgent };
  })()`);
  const report = { status: 'ok', kind: 'mock-browser-quality-matrix', cases: results, interactions,
    limitations: ['Mock IPC; not real provider latency', 'Chromium; not native WebKit frame or memory profiling', 'Computed font scaling; not real OS accessibility settings'] };
  if (captureDir) writeFileSync(join(captureDir, 'quality-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
