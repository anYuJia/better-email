import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Faults exist only in the browser mock bridge. These scenarios cannot deliver
// mail or touch native account data; they exercise the actual composer UI.
export async function runAttachmentQuality(cdp, api) {
  const { evalInPage, setUiViewport, waitForExpression, captureScreenshot, clickButton, fillInput, closeComposer, url, captureDir } = api;
  const cases = [[1440, 900], [1280, 800], [1024, 768], [390, 844], [393, 852], [430, 932]]
    .flatMap(([w, h]) => ['light', 'dark'].map(theme => ({ w, h, theme, scale: 1 })));
  for (const [w, h] of [[1440, 900], [390, 844]]) for (const scale of [1.25, 1.5]) cases.push({ w, h, theme: 'light', scale });
  const results = [];
  for (const item of cases) {
    const { w, h, theme, scale } = item;
    const label = `${w}x${h}-${theme}-${scale * 100}`;
    await setUiViewport(cdp, w, h);
    await evalInPage(cdp, `for (const key of Object.keys(localStorage)) if (/composerAutosave|composer-recovery/i.test(key)) localStorage.removeItem(key); localStorage.setItem('better-email.theme-mode', '${theme}'); localStorage.setItem('better-email.sendUndoDelaySeconds', '0'); history.replaceState({}, '', ${JSON.stringify(url)}); location.reload()`);
    await waitForExpression(cdp, "document.querySelector('.message-card-main')");
    await clickButton(cdp, '写邮件', w < 720 ? "document.querySelector('.mobile-bottom-nav')" : "document.querySelector('.sidebar')");
    await waitForExpression(cdp, "document.querySelector('.composer-editor-pane')");
    if (w < 720) {
      await evalInPage(cdp, "document.querySelector('.composer-tool-more').click()");
      await waitForExpression(cdp, "document.querySelector('.composer-more-menu')");
      const menu = await evalInPage(cdp, `(() => {
        const items = [...document.querySelectorAll('.composer-more-menu button')];
        return items.some(b => b.textContent.includes('保存')) && items.some(b => b.textContent.includes('签名'))
          && items.some(b => b.textContent.includes('模板')) && items.every(b => b.getBoundingClientRect().height >= 44);
      })()`);
      if (!menu) throw new Error('Mobile compose actions are missing or too small');
      await evalInPage(cdp, "[...document.querySelectorAll('.composer-more-menu button')].find(b => b.textContent.includes('模板')).click()");
      await waitForExpression(cdp, "document.querySelector('.composer-templates-popover')");
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await waitForExpression(cdp, "!document.querySelector('.composer-templates-popover') && document.activeElement === document.querySelector('.composer-tool-more')");
    }
    await fillInput(cdp, '.composer-recipient-field input', 'qa@example.com,');
    await fillInput(cdp, '.composer input[aria-label="主题"]', '大附件发送可靠性测试');
    await evalInPage(cdp, `(() => {
      window.__attachmentFailure = true;
      window.__betterEmailMockCommandOverride = async (command, args) => {
        if (command === 'save_temp_attachment') {
          await new Promise(resolve => setTimeout(resolve, 550));
          if (args.filename.startsWith('项目') && window.__attachmentFailure) throw new Error('磁盘暂时不可用，请重试；文件内容尚未保存');
        }
        return null;
      };
      const data = new DataTransfer();
      data.items.add(new File(['ready'], '已成功添加的附件.txt', { type: 'text/plain' }));
      data.items.add(new File(['retry'], '项目完整资料与大文件附件版本说明-very-long-english-filename-for-layout-check.zip', { type: 'application/zip' }));
      document.querySelector('.composer-body-field').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    })()`);
    await waitForExpression(cdp, "document.querySelector('.composer-transfer-list [data-import-state=\"preparing\"]')");
    if (!await evalInPage(cdp, "document.querySelector('.composer-send-primary').disabled")) throw new Error('Send unlocked while importing');
    await waitForExpression(cdp, "document.querySelector('.composer-transfer-list [data-import-state=\"failed\"]') && document.querySelector('.composer-attachment-list')?.textContent.includes('已成功添加的附件')");
    const check = async (surface) => {
      if (scale !== 1) await evalInPage(cdp, `(() => {
        const nodes = [...document.querySelectorAll('.composer *')];
        const sizes = nodes.map(node => [node, node.dataset.qaFontBase || getComputedStyle(node).fontSize]);
        for (const [node, size] of sizes) { node.dataset.qaFontBase = size; node.style.fontSize = parseFloat(size) * ${scale} + 'px'; }
      })()`);
      await waitForExpression(cdp, "document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)");
      const geometry = await evalInPage(cdp, `(() => {
        const panel = document.querySelector('.composer-transfer-status'); const rect = panel.getBoundingClientRect();
        const buttons = [...panel.querySelectorAll('button'), ...document.querySelectorAll('.composer-attachment-tile > button')].map(b => b.getBoundingClientRect());
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1 || panel.scrollWidth > panel.clientWidth + 1,
          visible: rect.height > 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
          minTarget: buttons.length ? Math.min(...buttons.map(r => Math.min(r.width, r.height))) : null,
          blocked: document.querySelector('.composer-send-primary').disabled,
          noDuplicateToast: ![...document.querySelectorAll('.message-toast')].some(t => /附件准备失败|邮件内容已保留/.test(t.textContent)) };
      })()`);
      if (geometry.overflow || !geometry.visible || !geometry.blocked || !geometry.noDuplicateToast || (w < 720 && geometry.minTarget !== null && geometry.minTarget < 44)) {
        throw new Error(`${label}/${surface}: ${JSON.stringify(geometry)}`);
      }
      results.push({ ...item, surface, ...geometry });
      await captureScreenshot(cdp, `attachments-${label}-${surface}`);
    };
    await check('partial-failure');
    await evalInPage(cdp, "window.__attachmentFailure = false; document.querySelector('.composer-transfer-actions button').focus(); document.querySelector('.composer-transfer-actions button').click()");
    await waitForExpression(cdp, "!document.querySelector('.composer-transfer-status') && !document.querySelector('.composer-send-primary').disabled && document.querySelector('.composer-attachment-list')?.textContent.includes('项目完整资料')");
    if (!await evalInPage(cdp, "document.activeElement?.getAttribute('aria-label') === '添加附件'")) throw new Error('Retry lost keyboard focus');
    await evalInPage(cdp, `window.__betterEmailMockCommandOverride = async (command) => {
      if (command === 'send_message') throw new Error('[SEND_OUTCOME_UNKNOWN] 服务器连接中断，发送结果需要核对');
      return null;
    }; document.querySelector('.composer-send-primary').click()`);
    await waitForExpression(cdp, "document.querySelector('[data-send-outcome=\"uncertain\"]')");
    await check('uncertain-delivery');
    const calls = await evalInPage(cdp, "window.__betterEmailMockInvocations.filter(c => c.command === 'send_message').map(c => ({count:c.args.input.attachments.length, taskId:c.args.taskId}))");
    if (calls.length !== 1 || calls[0].count !== 2 || !calls[0].taskId) throw new Error(`Attachment/task contract: ${JSON.stringify(calls)}`);
    await closeComposer(cdp);
  }
  // Restart with a partially prepared batch: keep both the ready file and the
  // missing-file reminder, and require re-selection before sending.
  await setUiViewport(cdp, 1440, 900);
  await evalInPage(cdp, "localStorage.setItem('better-email.theme-mode', 'light'); location.reload()");
  await waitForExpression(cdp, "document.querySelector('.message-card-main')");
  await clickButton(cdp, '写邮件', "document.querySelector('.sidebar')");
  await waitForExpression(cdp, "document.querySelector('.composer-editor-pane')");
  await evalInPage(cdp, `(() => {
    window.__betterEmailMockCommandOverride = async (command, args) => {
      if (command === 'save_temp_attachment' && args.filename === '恢复附件.txt') throw new Error('临时写入失败');
      return null;
    };
    const data = new DataTransfer();
    data.items.add(new File(['ready'], '保留成功附件.txt', { type: 'text/plain' }));
    data.items.add(new File(['retry'], '恢复附件.txt', { type: 'text/plain' }));
    document.querySelector('.composer-body-field').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  })()`);
  await waitForExpression(cdp, "JSON.parse(localStorage.getItem('better-email:composer-recovery-v1') || '{}').payload?.pending_attachments?.some(item => item.filename === '恢复附件.txt')");
  await evalInPage(cdp, 'location.reload()');
  await waitForExpression(cdp, "document.querySelector('.message-card-main')");
  await clickButton(cdp, '写邮件', "document.querySelector('.sidebar')");
  await waitForExpression(cdp, "document.querySelector('.composer-transfer-status')?.textContent.includes('恢复附件.txt') && document.querySelector('.composer-attachment-list')?.textContent.includes('保留成功附件') && document.querySelector('.composer-send-primary').disabled");
  await captureScreenshot(cdp, 'attachments-restart-missing-file-reminder');
  await evalInPage(cdp, `window.__betterEmailMockCommandOverride = async (command) => command === 'pick_outbound_attachments' ? { value: [{ filename:'恢复附件.txt', mime_type:'text/plain', size_bytes:5, local_path:'/tmp/better-email/恢复附件.txt' }] } : null;
    document.querySelector('.composer-transfer-actions button').click()`);
  await waitForExpression(cdp, "!document.querySelector('.composer-transfer-status') && document.querySelectorAll('.composer-attachment-tile').length === 2 && !document.querySelector('.composer-send-primary').disabled");
  results.push({ surface: 'restart-recovery', preservedReadyFile: true, blockedMissingFile: true, reselectedWithoutDuplicates: true });
  await closeComposer(cdp);

  // The command remains pending through a transient progress query failure.
  // Exercise its actual visible state instead of rendering a standalone mock.
  for (const { w, h, theme, scale } of cases.filter(item => item.w === 1440 || item.w === 390)) {
    await setUiViewport(cdp, w, h);
    await evalInPage(cdp, `localStorage.setItem('better-email.theme-mode', '${theme}'); location.reload()`);
    await waitForExpression(cdp, "document.querySelector('.message-card-main')");
    await clickButton(cdp, '写邮件', w < 720 ? "document.querySelector('.mobile-bottom-nav')" : "document.querySelector('.sidebar')");
    await waitForExpression(cdp, "document.querySelector('.composer-editor-pane')");
    await fillInput(cdp, '.composer-recipient-field input', 'qa@example.com,');
    await fillInput(cdp, '.composer input[aria-label="主题"]', '发送进度与失败恢复');
    await evalInPage(cdp, `(() => {
      window.__progressQueries = 0;
      window.__betterEmailMockCommandOverride = async (command) => {
        if (command === 'send_message') await new Promise((resolve, reject) => { window.__rejectAttachmentSend = reject; });
        if (command === 'get_background_task') {
          if (++window.__progressQueries === 1) throw new Error('临时查询失败');
          return { value: { status: 'running', progress: 60, message: '正在向发送服务器提交邮件，等待确认' } };
        }
        return null;
      };
      document.querySelector('.composer-send-primary').click();
    })()`);
    await waitForExpression(cdp, "document.querySelector('.composer-send-progress-message')?.textContent.includes('暂时中断')");
    await waitForExpression(cdp, "document.querySelector('.composer-send-progress-message')?.textContent.includes('等待确认')");
    if (scale !== 1) await evalInPage(cdp, `(() => {
      const sizes = [...document.querySelectorAll('.composer *')].map(node => [node, getComputedStyle(node).fontSize]);
      for (const [node, size] of sizes) node.style.fontSize = parseFloat(size) * ${scale} + 'px';
    })()`);
    const progress = await evalInPage(cdp, `(() => {
      const bar = document.querySelector('.composer-send-progress'); const rect = bar.getBoundingClientRect();
      return { blocked: document.querySelector('.composer-send-primary').disabled,
        namedBusy: document.querySelector('.composer-send-primary').textContent.includes('发送中') && document.querySelector('.composer-send-primary').getAttribute('aria-busy') === 'true',
        stageOnly: !bar.hasAttribute('aria-valuenow'), visible: rect.height > 0 && rect.bottom <= innerHeight,
        liveOutsideInert: !document.querySelector('.composer-backdrop > [role="status"]').closest('[inert]') };
    })()`);
    if (Object.values(progress).some(value => value !== true)) throw new Error(`Send progress: ${JSON.stringify(progress)}`);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    progress.reducedMotion = await evalInPage(cdp, "getComputedStyle(document.querySelector('.composer-send-progress-fill')).animationName === 'none'");
    if (!progress.reducedMotion) throw new Error('Send progress ignores reduced motion');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    results.push({ w, h, theme, scale, surface: 'active-send', ...progress });
    await captureScreenshot(cdp, `attachments-${w}x${h}-${theme}-${scale * 100}-active-send`);
    await evalInPage(cdp, "window.__rejectAttachmentSend(new Error('服务器明确拒绝接收，请检查附件大小'))");
    await waitForExpression(cdp, "document.querySelector('[data-send-outcome=\"failed\"]') && !document.querySelector('.composer-send-primary').disabled");
    if (!await evalInPage(cdp, "!document.querySelector('.message-toast.toast-error') && !document.querySelector('.composer-delivery-issue').textContent.includes('Error:')")) throw new Error('Send failure feedback is duplicated or raw');
    await captureScreenshot(cdp, `attachments-${w}x${h}-${theme}-${scale * 100}-send-failure`);
    results.push({ w, h, theme, scale, surface: 'send-failure', retryVisible: true });
    await closeComposer(cdp);
  }
  const report = { status: 'ok', scenarios: results.length, results };
  if (captureDir) writeFileSync(join(captureDir, 'attachment-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
