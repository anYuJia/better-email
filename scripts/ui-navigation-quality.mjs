import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Slow and failed IPC fixtures run only in the explicitly seeded mock profile.
export async function runNavigationQuality(cdp, api) {
  const { evalInPage, setUiViewport, waitForExpression, captureScreenshot, url, captureDir } = api;
  const checks = [];
  const assert = async (expression, name) => {
    if (!await evalInPage(cdp, expression)) throw new Error(name);
    checks.push(name);
  };
  const selectFolder = async (role) => {
    await evalInPage(cdp, `document.querySelector('.folder[data-folder-role="${role}"] .folder-main').click()`);
  };
  await setUiViewport(cdp, 1180, 760);
  await evalInPage(cdp, `history.replaceState({}, '', ${JSON.stringify(url)}); location.reload()`);
  await waitForExpression(cdp, "document.querySelector('.message-card-main') && document.querySelector('.reader h1')");
  await evalInPage(cdp, `(() => {
    window.__pendingMailboxReads = [];
    window.__betterEmailMockCommandOverride = (command, args) => command === 'list_messages'
      ? new Promise((resolve, reject) => window.__pendingMailboxReads.push({ args, resolve, reject })) : null;
  })()`);
  await selectFolder('trash');
  await waitForExpression(cdp, 'window.__pendingMailboxReads.length === 1');
  await assert("document.querySelector('.folder[data-folder-role=trash] .folder-main').getAttribute('aria-current') === 'page' && !!document.querySelector('.mailbox-list-content[hidden]') && !!document.querySelector('.mailbox-load-state[aria-busy=true]')", 'Navigation feedback precedes the requested content');
  await assert("!document.querySelector('.reader h1') && !document.querySelector('.reader-actions')", 'Old message and actions are unavailable while navigating');
  await evalInPage(cdp, 'window.__navigationMutationStart = window.__betterEmailMockInvocations.length');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
  await assert("!window.__betterEmailMockInvocations.slice(window.__navigationMutationStart).some(call => /delete|move_message|set_message/.test(call.command))", 'Keyboard actions cannot mutate hidden stale mail');
  await captureScreenshot(cdp, 'navigation-1180-pending');
  await selectFolder('archive');
  await waitForExpression(cdp, 'window.__pendingMailboxReads.length === 2');
  await evalInPage(cdp, 'window.__pendingMailboxReads[0].resolve(null)');
  await assert("!!document.querySelector('.mailbox-list-content[hidden]') && document.querySelector('.folder[data-folder-role=archive] .folder-main').getAttribute('aria-current') === 'page'", 'Late response cannot expose the previous folder');
  await evalInPage(cdp, "window.__pendingMailboxReads[1].reject(new Error('模拟离线'))");
  await waitForExpression(cdp, "document.querySelector('.mailbox-load-state [role=alert] button')");
  await assert("!document.querySelector('.mailbox-load-state[aria-busy=true]')", 'Loading failure becomes an explicit retryable error');
  await captureScreenshot(cdp, 'navigation-1180-retry');
  await evalInPage(cdp, 'window.__betterEmailMockCommandOverride = null; document.querySelector(".mailbox-load-state button").click()');
  await waitForExpression(cdp, "!document.querySelector('.mailbox-load-state') && !document.querySelector('.mailbox-list-content[hidden]')");
  checks.push('Retry releases loading for a successful empty or nonempty result');
  await selectFolder('inbox');
  await waitForExpression(cdp, "!document.querySelector('.mailbox-load-state') && document.querySelectorAll('.message-card-main').length > 3 && document.querySelector('.reader h1')");
  await evalInPage(cdp, `(() => {
    window.__pendingDetail = [];
    window.__betterEmailMockCommandOverride = (command, args) => command === 'get_message_detail'
      ? new Promise(resolve => window.__pendingDetail.push({ args, resolve })) : null;
    const row = document.querySelectorAll('.message-card')[3];
    window.__navigationExpectedSubject = row.querySelector('.subject')?.textContent;
    row.querySelector('.message-card-main').click();
  })()`);
  await waitForExpression(cdp, 'window.__pendingDetail.length > 0');
  await assert("document.querySelector('.reader h1')?.textContent === window.__navigationExpectedSubject", 'New summary header is visible while only its detail loads');
  await captureScreenshot(cdp, 'navigation-1180-detail-loading');
  await evalInPage(cdp, 'window.__betterEmailMockCommandOverride = null; window.__pendingDetail.forEach(item => item.resolve(null))');
  await waitForExpression(cdp, "!document.querySelector('.email-reader-skeleton-body') && document.querySelector('.reader h1')");
  await captureScreenshot(cdp, 'navigation-1180-settled');

  await evalInPage(cdp, "document.querySelector('.list-control-tabs > button:last-of-type').click()");
  await waitForExpression(cdp, `(() => {
    const active = document.querySelector('.list-control-tabs[data-active-mode="threads"] button[aria-pressed="true"]');
    const indicator = document.querySelector('.list-control-tab-indicator');
    return active && Math.abs(active.getBoundingClientRect().left - indicator.getBoundingClientRect().left) < 1;
  })()`);
  checks.push('Mode indicator settles under the active conversation tab');
  await evalInPage(cdp, "document.querySelector('.filter-menu > summary').click()");
  await waitForExpression(cdp, "document.querySelector('.filter-menu[open][data-menu-positioned=true]')");
  await assert(`(() => {
    const panel = document.querySelector('.filter-menu [role=menu]').getBoundingClientRect();
    const list = document.querySelector('.message-list-panel').getBoundingClientRect();
    return panel.left >= list.left && panel.right <= list.right;
  })()`, 'Filter menu opens inward within the message list pane');
  await evalInPage(cdp, "document.querySelector('.filter-menu [aria-checked=true]').click()");

  await setUiViewport(cdp, 1280, 800);
  for (const theme of ['light', 'dark']) {
    await evalInPage(cdp, `localStorage.setItem('better-email.theme-mode', '${theme}'); location.reload()`);
    await waitForExpression(cdp, `document.documentElement.dataset.theme === '${theme}' && document.querySelector('.reader-html') && document.querySelector('.message-card-main')`);
    await captureScreenshot(cdp, `workspace-1280-${theme}`);
  }

  await setUiViewport(cdp, 1024, 768);
  await waitForExpression(cdp, "document.querySelector('[data-narrow-sidebar-open]')?.getBoundingClientRect().width > 0");
  await evalInPage(cdp, "document.querySelector('[data-narrow-sidebar-open]').click()");
  await waitForExpression(cdp, "document.querySelector('.narrow-view-sidebar [data-narrow-sidebar-close]')?.getBoundingClientRect().width > 0");
  await assert(`(() => {
    const close = document.querySelector('[data-narrow-sidebar-close]');
    const r = close.getBoundingClientRect();
    const titlebar = document.querySelector('.app-titlebar').getBoundingClientRect();
    return r.top >= titlebar.bottom && close.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  })()`, 'Narrow sidebar close remains visible and clickable below the titlebar');
  await captureScreenshot(cdp, 'workspace-1024-drawer');
  await evalInPage(cdp, "document.querySelector('[data-narrow-sidebar-close]').click()");
  await waitForExpression(cdp, "!document.querySelector('.narrow-view-sidebar') && document.activeElement?.hasAttribute('data-narrow-sidebar-open')");
  checks.push('Closing the narrow sidebar returns focus to its opener');
  if (captureDir) {
    mkdirSync(captureDir, { recursive: true });
    writeFileSync(join(captureDir, 'navigation-quality.json'), JSON.stringify({ checks }, null, 2));
  }
  console.log(JSON.stringify({ status: 'ok', navigationChecks: checks.length, captureDir }, null, 2));
}
