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
  // Exercise help before opening the lazy composer. Its backdrop must not rely
  // on the composer's separately loaded CSS or become a sidebar grid item.
  await evalInPage(cdp, "document.querySelector('.shortcut-help-button').focus(); document.querySelector('.shortcut-help-button').click()");
  await waitForExpression(cdp, "document.querySelector('.shortcut-modal') && document.activeElement === document.querySelector('.shortcut-close-button')");
  await assert(`(() => {
    const backdrop = document.querySelector('.shortcut-backdrop');
    const modal = document.querySelector('.shortcut-modal').getBoundingClientRect();
    const screen = backdrop.getBoundingClientRect();
    const rowsFit = [...document.querySelectorAll('.shortcut-row')].every(row => {
      const label = row.querySelector('span').getBoundingClientRect();
      const keys = row.querySelector('div').getBoundingClientRect();
      return label.right <= keys.left + 1 || label.bottom <= keys.top + 1;
    });
    return backdrop.parentElement === document.body && getComputedStyle(backdrop).position === 'fixed'
      && Math.abs(screen.width - innerWidth) < 1 && Math.abs(screen.height - innerHeight) < 1
      && modal.width >= 700 && Math.abs(modal.left + modal.width / 2 - innerWidth / 2) < 2 && rowsFit;
  })()`, 'Shortcut help opens centered across the viewport before the composer loads');
  await captureScreenshot(cdp, 'shortcut-help-cold-start');
  for (const scale of [1.25, 1.5]) {
    await evalInPage(cdp, `(() => {
      for (const el of document.querySelectorAll('.shortcut-modal *')) {
        el.dataset.shortcutFontBase ||= getComputedStyle(el).fontSize;
        el.style.fontSize = parseFloat(el.dataset.shortcutFontBase) * ${scale} + 'px';
      }
    })()`);
    await assert(`(() => {
      const modal = document.querySelector('.shortcut-modal');
      return modal.scrollWidth <= modal.clientWidth + 1
        && [...modal.querySelectorAll('.shortcut-row')].every(row => {
          const label = row.querySelector('span').getBoundingClientRect();
          const keys = row.querySelector('div').getBoundingClientRect();
          return (label.right <= keys.left + 1 || label.bottom <= keys.top + 1)
            && row.scrollWidth <= row.clientWidth + 1;
        });
    })()`, `Shortcut help remains readable at ${scale * 100}% text size`);
    await captureScreenshot(cdp, `shortcut-help-${scale * 100}pct`);
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitForExpression(cdp, "!document.querySelector('.shortcut-modal') && document.activeElement === document.querySelector('.shortcut-help-button')");
  checks.push('Escape closes shortcut help and restores its opener');
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
  await evalInPage(cdp, "document.querySelector('.shortcut-help-button').focus(); document.querySelector('.shortcut-help-button').click()");
  await waitForExpression(cdp, "document.querySelector('.shortcut-modal') && document.activeElement === document.querySelector('.shortcut-close-button')");
  await assert(`(() => {
    const backdrop = document.querySelector('.shortcut-backdrop').getBoundingClientRect();
    const modal = document.querySelector('.shortcut-modal').getBoundingClientRect();
    return Math.abs(backdrop.width - innerWidth) < 1 && modal.width >= 700
      && Math.abs(modal.left + modal.width / 2 - innerWidth / 2) < 2;
  })()`, 'Shortcut help covers the window when opened from the narrow sidebar');
  await captureScreenshot(cdp, 'shortcut-help-1024');
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitForExpression(cdp, "!document.querySelector('.shortcut-modal') && document.activeElement === document.querySelector('.shortcut-help-button')");
  await evalInPage(cdp, "document.querySelector('[data-narrow-sidebar-close]').click()");
  await waitForExpression(cdp, "!document.querySelector('.narrow-view-sidebar') && document.activeElement?.hasAttribute('data-narrow-sidebar-open')");
  checks.push('Closing the narrow sidebar returns focus to its opener');
  // Bulk selection keeps the compact message text alignment and an accessible
  // checkbox at desktop and touch breakpoints, including enlarged text.
  for (const [width, height, theme, scale] of [
    [1440, 900, 'light', 1], [1280, 800, 'dark', 1], [1024, 768, 'light', 1],
    [390, 844, 'dark', 1], [393, 852, 'light', 1], [430, 932, 'dark', 1],
    [390, 844, 'light', 1.25], [430, 932, 'dark', 1.5],
  ]) {
    await setUiViewport(cdp, width, height);
    await evalInPage(cdp, `localStorage.setItem('better-email.theme-mode', '${theme}'); location.reload()`);
    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length > 1");
    await evalInPage(cdp, `(() => {
      const row = document.querySelector('.message-card');
      window.__selectionBaseline = {
        padding: getComputedStyle(row).paddingLeft,
        senderLeft: row.querySelector('.sender').getBoundingClientRect().left,
      };
      row.querySelector('.message-select input').click();
    })()`);
    await waitForExpression(cdp, "document.querySelector('.message-card.is-selection-mode .message-select input:checked')");
    if (scale !== 1) await evalInPage(cdp, `(() => {
      for (const el of document.querySelectorAll('.message-card *')) {
        el.style.fontSize = parseFloat(getComputedStyle(el).fontSize) * ${scale} + 'px';
      }
    })()`);
    await assert(`(() => {
      const rows = [...document.querySelectorAll('.message-card')].slice(0, 2);
      return rows.length === 2 && document.documentElement.scrollWidth <= innerWidth + 1 && rows.every(row => {
        const target = row.querySelector('.message-select').getBoundingClientRect();
        const input = row.querySelector('.message-select input');
        const sender = row.querySelector('.sender').getBoundingClientRect();
        const avatarOpacity = getComputedStyle(row.querySelector('.message-leading')).opacity;
        return getComputedStyle(row).paddingLeft === window.__selectionBaseline.padding
          && Math.abs(sender.left - window.__selectionBaseline.senderLeft) <= 1
          && getComputedStyle(input).borderRadius === '4px'
          && (innerWidth > 720 ? avatarOpacity === '1' : avatarOpacity === '0')
          && (innerWidth > 720 || (target.width >= 44 && target.height >= 44));
      }) && rows[0].querySelector('input').checked && !rows[1].querySelector('input').checked
        && getComputedStyle(rows[0].querySelector('input'), '::before').transform !== getComputedStyle(rows[1].querySelector('input'), '::before').transform;
    })()`, `Compact selection stays aligned at ${width}x${height}, ${theme}, ${scale * 100}%`);
    await captureScreenshot(cdp, `selection-${width}-${height}-${theme}-${scale * 100}`);
  }
  if (captureDir) {
    mkdirSync(captureDir, { recursive: true });
    writeFileSync(join(captureDir, 'navigation-quality.json'), JSON.stringify({ checks }, null, 2));
  }
  console.log(JSON.stringify({ status: 'ok', navigationChecks: checks.length, captureDir }, null, 2));
}
