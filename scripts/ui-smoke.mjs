import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const port = Number(
  process.env.BETTER_EMAIL_UI_SMOKE_PORT
  ?? process.env.SWIFTMAIL_UI_SMOKE_PORT
  ?? 1430,
);
const url = `http://127.0.0.1:${port}`;
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'google-chrome',
  'chromium',
  'chrome',
].filter(Boolean);

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopChild(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill(signal);
  await Promise.race([exited, sleep(2000)]);
}

async function removeDirWithRetry(path) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(250);
    }
  }
}

async function waitForHttp(target, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(target);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${target}`);
}

async function findChrome() {
  for (const candidate of chromeCandidates) {
    const child = spawn(candidate, ['--version'], { stdio: 'ignore' });
    const code = await new Promise((resolve) => child.once('exit', resolve));
    if (code === 0) return candidate;
  }
  throw new Error('Chrome/Chromium executable not found; set CHROME_PATH to run UI smoke tests.');
}

async function chromeJson(debugPort, path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`Chrome CDP request failed: ${path}`);
  return response.json();
}

async function openCdp(debugPort, pageUrl) {
  const deadline = Date.now() + 10_000;
  let target = null;
  while (Date.now() < deadline) {
    const targets = await chromeJson(debugPort, '/json/list');
    target =
      targets.find((entry) => entry.type === 'page' && entry.url?.startsWith(pageUrl)) ??
      targets.find((entry) => entry.type === 'page');
    if (target?.webSocketDebuggerUrl) break;
    await sleep(150);
  }
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`Chrome page target not found for ${pageUrl}`);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];

  function failPending(error) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  }

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) {
      events.push(message);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  function send(method, params = {}) {
    if (ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Chrome CDP socket is not open for ${method}`));
    }
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for Chrome CDP response: ${method}`));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
    });
  }

  ws.addEventListener('error', () => failPending(new Error('Chrome CDP socket error')));
  ws.addEventListener('close', () => failPending(new Error('Chrome CDP socket closed')));

  return { send, events, close: () => ws.close() };
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `Boolean(${expression})`,
      awaitPromise: true,
      returnByValue: true,
    });
    lastValue = result.result?.value;
    if (lastValue) return lastValue;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for expression: ${expression}; last=${JSON.stringify(lastValue)}`);
}

async function evalInPage(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'Page evaluation failed');
  }
  return result.result?.value;
}

async function clickButton(cdp, text, scope = 'document') {
  await evalInPage(
    cdp,
    `(() => {
      const root = ${scope};
      const button = [...root.querySelectorAll('button')].find((item) => item.textContent.includes(${JSON.stringify(text)}));
      if (!button) throw new Error('Button not found: ${text}');
      button.click();
    })()`,
  );
}

async function openDetails(cdp, selector) {
  await evalInPage(
    cdp,
    `(() => {
      const details = document.querySelector(${JSON.stringify(selector)});
      if (!details) throw new Error('Details menu not found: ${selector}');
      details.open = true;
      details.dispatchEvent(new Event('toggle', { bubbles: true }));
    })()`,
  );
}

async function fillInput(cdp, selector, value, index = 0) {
  await evalInPage(
    cdp,
    `(() => {
      const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!element) throw new Error('Input not found: ${selector}[${index}]');
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  );
}

async function selectValue(cdp, selector, value, index = 0) {
  await evalInPage(
    cdp,
    `(() => {
      const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!element) throw new Error('Select not found: ${selector}[${index}]');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function selectOptionByText(cdp, selector, text, index = 0) {
  await evalInPage(
    cdp,
    `(() => {
      const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!element) throw new Error('Select not found: ${selector}[${index}]');
      const option = [...element.options].find((item) => item.textContent.includes(${JSON.stringify(text)}));
      if (!option) throw new Error('Select option not found: ${text}');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter.call(element, option.value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
}

async function dragElement(cdp, selector, deltaX) {
  const rect = await evalInPage(
    cdp,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Drag target not found: ${selector}');
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`,
  );
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.x,
    y: rect.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: rect.x + deltaX,
    y: rect.y,
    button: 'left',
    buttons: 1,
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.x + deltaX,
    y: rect.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
}

async function main() {
  const vite = spawnLogged('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, VITE_BETTER_EMAIL_UI_MOCK: '1' },
  });
  const profileDir = mkdtempSync(join(tmpdir(), 'better-email-ui-smoke-'));
  let chrome;
  let cdp;
  try {
    await waitForHttp(url);
    const chromePath = await findChrome();
    const debugPort = port + 1000;
    chrome = spawnLogged(chromePath, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      url,
    ]);
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);
    cdp = await openCdp(debugPort, url);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, "document.querySelector('.app-shell') && document.body.innerText.includes('Better Email')");

    await evalInPage(
      cdp,
      "localStorage.removeItem('better-email.appLayout.v2'); localStorage.setItem('swiftmail.appLayout.v2', JSON.stringify({ sidebar: 278, list: 422 })); location.reload()",
    );
    await waitForExpression(cdp, "document.querySelector('.app-shell')?.style.gridTemplateColumns.includes('278px') && document.querySelector('.app-shell')?.style.gridTemplateColumns.includes('422px')");
    await waitForExpression(cdp, "JSON.parse(localStorage.getItem('better-email.appLayout.v2')).sidebar === 278 && localStorage.getItem('swiftmail.appLayout.v2') === null");
    await evalInPage(
      cdp,
      "localStorage.setItem('better-email.appLayout.v2', JSON.stringify({ sidebar: 244, list: 388 })); location.reload()",
    );
    await waitForExpression(cdp, "document.querySelector('.app-shell')?.style.gridTemplateColumns.includes('244px') && document.querySelector('.app-shell')?.style.gridTemplateColumns.includes('388px')");

    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length === 40 && document.body.innerText.includes('已显示 40 封') && document.body.innerText.includes('加载更多')");
    await clickButton(cdp, '加载更多', "document.querySelector('.message-list-footer')");
    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length >= 50 && document.body.innerText.includes('已显示 50 封') && document.body.innerText.includes('已到底')");
    await waitForExpression(cdp, "document.body.innerText.includes('远程图片默认阻止')");
    const checks = [true, true, true];
    const initialLayout = await evalInPage(
      cdp,
      `(() => {
        const columns = document.querySelector('.app-shell')?.style.gridTemplateColumns ?? '';
        const match = columns.match(/^(\\d+)px 5px (\\d+)px 5px/);
        if (!match) throw new Error('Initial app layout was not rendered');
        return { sidebar: Number(match[1]), list: Number(match[2]) };
      })()`,
    );
    const expectedSidebar = Math.min(320, Math.max(228, initialLayout.sidebar + 34));
    const expectedList = Math.min(500, Math.max(340, initialLayout.list - 44));

    await dragElement(cdp, '.sidebar-resizer', 34);
    await waitForExpression(cdp, `document.querySelector('.app-shell').style.gridTemplateColumns.includes('${expectedSidebar}px')`);
    await waitForExpression(cdp, `JSON.parse(localStorage.getItem('better-email.appLayout.v2')).sidebar === ${expectedSidebar}`);
    await dragElement(cdp, '.list-resizer', -44);
    await waitForExpression(cdp, `document.querySelector('.app-shell').style.gridTemplateColumns.includes('${expectedList}px')`);
    await waitForExpression(cdp, `JSON.parse(localStorage.getItem('better-email.appLayout.v2')).list === ${expectedList}`);
    await openDetails(cdp, '.background-sync-card');
    await clickButton(cdp, '重置布局', "document.querySelector('.background-sync-card')");
    await waitForExpression(
      cdp,
      `document.querySelector('.app-shell').style.gridTemplateColumns.includes('${initialLayout.sidebar}px') && document.querySelector('.app-shell').style.gridTemplateColumns.includes('${initialLayout.list}px')`,
    );
    await waitForExpression(
      cdp,
      `JSON.parse(localStorage.getItem('better-email.appLayout.v2')).sidebar === ${initialLayout.sidebar} && JSON.parse(localStorage.getItem('better-email.appLayout.v2')).list === ${initialLayout.list}`,
    );
    await waitForExpression(cdp, "document.querySelector('.brand-mark')?.textContent.trim() === 'B'");
    await waitForExpression(cdp, "document.querySelector('.account-switcher-trigger') && !document.querySelector('.account-switcher select')");
    await openDetails(cdp, '.more-mailboxes');
    await waitForExpression(cdp, "(() => { const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect(); const list = document.querySelector('.more-mailboxes[open] > .folded-folder-list')?.getBoundingClientRect(); return sidebar && list && list.left >= sidebar.left && list.right <= sidebar.right + 1; })()");
    await evalInPage(
      cdp,
      "(() => { const folder = document.querySelector('.more-mailboxes .folder[data-folder-role=\"spam\"]'); if (!folder) throw new Error('Spam folder favorite target not found'); folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 350, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')?.innerText.includes('固定到常用邮箱')");
    await clickButton(cdp, '固定到常用邮箱', "document.querySelector('.context-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已固定到常用邮箱：垃圾邮件') && document.querySelector('.primary-folder-list .folder[data-folder-role=\"spam\"][data-favorite=\"true\"]') && JSON.parse(localStorage.getItem('better-email.favoriteFolderKeys.v1')).includes('virtual:spam')");
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForExpression(cdp, "document.querySelector('.app-shell') && document.querySelector('.primary-folder-list .folder[data-folder-role=\"spam\"][data-favorite=\"true\"]')");
    await evalInPage(
      cdp,
      "(() => { const folder = document.querySelector('.primary-folder-list .folder[data-folder-role=\"spam\"]'); if (!folder) throw new Error('Pinned spam folder not found'); folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 350, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')?.innerText.includes('从常用邮箱移除')");
    await clickButton(cdp, '从常用邮箱移除', "document.querySelector('.context-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已从常用邮箱移除：垃圾邮件') && document.querySelector('.more-mailboxes .folder[data-folder-role=\"spam\"]') && !JSON.parse(localStorage.getItem('better-email.favoriteFolderKeys.v1')).includes('virtual:spam')");

    await evalInPage(
      cdp,
      "(() => { const folder = document.querySelector('.primary-folder-list .folder[data-folder-role=\"inbox\"]'); const badge = folder?.querySelector('.badge'); if (!folder || !badge || Number(badge.textContent) <= 0) throw new Error('Inbox unread folder target not found'); window.__folderUnreadBefore = Number(badge.textContent); folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 180, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')?.innerText.includes('全部标为已读')");
    await clickButton(cdp, '全部标为已读', "document.querySelector('.context-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes(`已将 ${window.__folderUnreadBefore} 封邮件标为已读`) && !document.querySelector('.primary-folder-list .folder[data-folder-role=\"inbox\"] .badge')");
    await evalInPage(
      cdp,
      "(() => { const folder = document.querySelector('.more-mailboxes .folder[data-folder-role=\"trash\"]'); if (!folder) throw new Error('Trash folder context target not found'); folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 380, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')?.innerText.includes('清空废纸篓')");
    await clickButton(cdp, '清空废纸篓', "document.querySelector('.context-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已清空废纸篓：永久删除')");

    await clickButton(cdp, '快捷键');
    await waitForExpression(cdp, "document.querySelector('.shortcut-modal') && document.body.innerText.includes('高频邮件操作') && document.body.innerText.includes('聚焦搜索') && document.body.innerText.includes('选择当前列表全部邮件') && document.body.innerText.includes('撤销上一步邮件操作')");
    await clickButton(cdp, '关闭', "document.querySelector('.shortcut-modal')");
    await waitForExpression(cdp, "!document.querySelector('.shortcut-modal')");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }))");
    await waitForExpression(cdp, "document.querySelector('.shortcut-modal') && document.body.innerText.includes('回复全部') && document.body.innerText.includes('移到废纸篓')");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitForExpression(cdp, "!document.querySelector('.shortcut-modal')");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))");
    await waitForExpression(cdp, "document.querySelector('.command-palette') && document.body.innerText.includes('写邮件') && document.body.innerText.includes('刷新邮箱')");
    await fillInput(cdp, '.command-palette input', '线程');
    await waitForExpression(cdp, "document.querySelector('.command-palette') && document.body.innerText.includes('显示会话线程')");
    await evalInPage(cdp, "document.querySelector('.command-palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "!document.querySelector('.command-palette') && document.querySelector('.thread-list')");
    await clickButton(cdp, '命令');
    await fillInput(cdp, '.command-palette input', '邮件列表');
    await evalInPage(cdp, "document.querySelector('.command-palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "!document.querySelector('.command-palette') && document.querySelector('.message-list')");

    await fillInput(cdp, '.search-box input', 'Quarterly');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "document.body.innerText.includes('Quarterly update')");
    await openDetails(cdp, '.search-options-menu');
    await waitForExpression(cdp, "document.querySelector('.search-options-menu[open]') && document.querySelector('.search-options-menu').innerText.includes('未读') && document.querySelector('.search-options-menu').innerText.includes('附件名') && document.querySelector('.search-options-menu').innerText.includes('发件人') && document.querySelector('.search-options-menu').innerText.includes('邮箱')");
    await clickButton(cdp, '附件名', "document.querySelector('.search-options-menu')");
    await waitForExpression(cdp, "document.querySelector('.search-box input').value === 'Quarterly filename:' && document.body.innerText.includes('已插入搜索条件：filename:')");
    await fillInput(cdp, '.search-box input', 'filename:security-checklist.pdf');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await evalInPage(cdp, "document.querySelector('.search-clear-button').click()");
    await waitForExpression(cdp, "document.querySelector('.search-box input').value === '' && document.querySelectorAll('.message-card').length >= 2 && document.body.innerText.includes('已清空搜索和筛选')");
    await fillInput(cdp, '.search-box input', 'Quarterly');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "document.body.innerText.includes('Quarterly update')");
    await openDetails(cdp, '.sidebar-tools');
    await fillInput(cdp, '.saved-search-form input', '季度更新');
    await clickButton(cdp, '保存', "document.querySelector('.saved-search-form')");
    await waitForExpression(cdp, "document.body.innerText.includes('已保存搜索：季度更新') && document.body.innerText.includes('季度更新')");
    await fillInput(cdp, '.search-box input', '安全');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await clickButton(cdp, '季度更新', "document.querySelector('.saved-search-list')");
    await waitForExpression(cdp, "document.querySelector('.search-box input').value === 'Quarterly' && document.body.innerText.includes('Quarterly update') && document.body.innerText.includes('已运行保存搜索：季度更新')");
    await fillInput(cdp, '.contact-center > input', 'security');
    await waitForExpression(cdp, "document.querySelector('.contact-list').innerText.includes('security@example.com') && !document.querySelector('.contact-list').innerText.includes('ada@example.com')");
    await evalInPage(
      cdp,
      "(() => { const contact = [...document.querySelectorAll('.contact-list .contact-row')].find((item) => item.textContent.includes('security@example.com')); if (!contact) throw new Error('Contact context target not found'); contact.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 520, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')?.innerText.includes('编辑联系人') && document.querySelector('.context-menu')?.innerText.includes('删除联系人')");
    await clickButton(cdp, '编辑联系人', "document.querySelector('.context-menu')");
    await waitForExpression(cdp, "document.querySelector('.settings-modal') && document.querySelector('.settings-contact-panel .contact-edit-form')");
    await clickButton(cdp, '取消', "document.querySelector('.settings-contact-panel .contact-edit-form')");
    await evalInPage(cdp, "[...document.querySelectorAll('.settings-modal header button')].find((button) => button.textContent.includes('关闭')).click()");
    await waitForExpression(cdp, "!document.querySelector('.settings-modal')");
    await clickButton(cdp, 'Security Team', "document.querySelector('.contact-list')");
    await waitForExpression(cdp, "document.querySelector('.composer input[placeholder=\"收件人\"]').value.includes('security@example.com') && document.body.innerText.includes('正在给 Security Team 写邮件')");
    await evalInPage(cdp, "document.querySelector('.composer header button[aria-label=\"关闭写信窗口\"]')?.click() || [...document.querySelectorAll('.composer header button')].find((button) => button.textContent.includes('关闭')).click()");
    await waitForExpression(cdp, "!document.querySelector('.composer')");
    await fillInput(cdp, '.search-box input', '');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length >= 2");

    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }))");
    await fillInput(cdp, '.command-palette input', '写给 Ada');
    await evalInPage(cdp, "document.querySelector('.command-palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "!document.querySelector('.command-palette') && document.querySelector('.composer input[placeholder=\"收件人\"]').value.includes('ada@example.com')");
    await evalInPage(cdp, "document.querySelector('.composer header button[aria-label=\"关闭写信窗口\"]')?.click() || [...document.querySelectorAll('.composer header button')].find((button) => button.textContent.includes('关闭')).click()");
    await waitForExpression(cdp, "!document.querySelector('.composer')");

    await clickButton(cdp, '写邮件');
    await waitForExpression(cdp, "document.body.innerText.includes('新邮件') && document.querySelector('.composer textarea')");
    await clickButton(cdp, '最小化', "document.querySelector('.composer header')");
    await waitForExpression(cdp, "document.querySelector('.composer-minimized') && document.body.innerText.includes('展开')");
    await clickButton(cdp, '展开', "document.querySelector('.composer-minimized')");
    await waitForExpression(cdp, "document.querySelector('.composer textarea')");
    await waitForExpression(cdp, "document.querySelector('.composer-advanced:not([open])')");
    await waitForExpression(cdp, "document.querySelector('#contact-suggestions option[value=\"ada@example.com\"]') && document.body.innerText.includes('常用联系人')");
    await clickButton(cdp, 'Ada', "document.querySelector('.recipient-suggestions')");
    await waitForExpression(cdp, "document.querySelector('.composer input[placeholder=\"收件人\"]').value.includes('ada@example.com')");
    await fillInput(cdp, '.composer input[placeholder=\"收件人\"]', 'ada@example.com');
    await fillInput(cdp, '.composer input[placeholder=\"主题\"]', 'Smoke Draft Flow');
    await fillInput(cdp, '.composer textarea[placeholder=\"正文\"]', '保存草稿路径验证');
    await waitForExpression(cdp, "JSON.parse(localStorage.getItem('better-email.composerAutosave')).draft.subject === 'Smoke Draft Flow' && document.body.innerText.includes('自动保存')");
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForExpression(cdp, "document.querySelector('.app-shell') && document.body.innerText.includes('Better Email')");
    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length >= 2");
    await clickButton(cdp, '写邮件');
    await waitForExpression(cdp, "document.querySelector('.composer input[placeholder=\"主题\"]').value === 'Smoke Draft Flow' && document.querySelector('.composer textarea[placeholder=\"正文\"]').value === '保存草稿路径验证' && document.body.innerText.includes('已恢复自动保存草稿')");
    await openDetails(cdp, '.composer-advanced');
    await fillInput(cdp, '.composer-template-save input[placeholder=\"模板名称\"]', 'Smoke 模板');
    await clickButton(cdp, '保存当前', "document.querySelector('.composer-template-save')");
    await waitForExpression(cdp, "document.body.innerText.includes('模板已保存：Smoke 模板')");
    await fillInput(cdp, '.composer input[placeholder=\"主题\"]', 'Smoke Template Mutated');
    await fillInput(cdp, '.composer textarea[placeholder=\"正文\"]', '模板覆盖前正文');
    await clickButton(cdp, 'Smoke 模板', "document.querySelector('.composer-template-list')");
    await waitForExpression(cdp, "document.querySelector('.composer input[placeholder=\"主题\"]').value === 'Smoke Draft Flow' && document.querySelector('.composer textarea[placeholder=\"正文\"]').value === '保存草稿路径验证' && document.body.innerText.includes('已插入模板：Smoke 模板')");
    await evalInPage(cdp, `(() => {
      const target = document.querySelector('.composer-attachments');
      if (!target) throw new Error('Composer attachment drop zone not found');
      const data = new DataTransfer();
      data.items.add(new File(['drop-check'], 'dragged-notes.md', { type: 'text/markdown' }));
      target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }));
    })()`);
    await waitForExpression(cdp, "document.querySelector('.composer-attachments.drop-active')");
    await evalInPage(cdp, `(() => {
      const target = document.querySelector('.composer-attachments');
      if (!target) throw new Error('Composer attachment drop zone not found');
      const data = new DataTransfer();
      data.items.add(new File(['drop-check'], 'dragged-notes.md', { type: 'text/markdown' }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    })()`);
    await waitForExpression(cdp, "document.body.innerText.includes('dragged-notes.md') && document.body.innerText.includes('已拖入附件 1 个')");
    await clickButton(cdp, '添加附件', "document.querySelector('.composer-attachments')");
    await waitForExpression(cdp, "document.body.innerText.includes('smoke-brief.txt') && document.body.innerText.includes('已添加附件 1 个') && document.body.innerText.includes('已添加 2 个附件')");
    await evalInPage(cdp, "(() => { const toggle = [...document.querySelectorAll('.composer-rich-toggle input[type=\"checkbox\"]')].find((item) => item.closest('label')?.textContent.includes('富文本 HTML')); if (!toggle) throw new Error('Rich composer toggle not found'); toggle.click(); })()");
    await waitForExpression(cdp, "document.querySelector('.composer-html-source')");
    await clickButton(cdp, 'B', "document.querySelector('.rich-toolbar')");
    await clickButton(cdp, '列表', "document.querySelector('.rich-toolbar')");
    await waitForExpression(cdp, "document.querySelector('.composer-html-source').value.includes('<strong>加粗文字</strong>') && document.querySelector('.composer-html-source').value.includes('<ul><li>列表项</li></ul>')");
    await evalInPage(cdp, "(() => { const select = document.querySelector('.composer select[aria-label=\"发件身份\"]'); const option = [...select.options].find((item) => item.textContent.includes('Demo Support')); if (!option) throw new Error('Sender identity option not ready'); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await waitForExpression(cdp, "document.body.innerText.includes('Better Email Support')");
    await clickButton(cdp, '插入签名', "document.querySelector('.composer-signature')");
    await waitForExpression(cdp, "document.querySelector('.composer textarea').value.includes('Better Email Support')");
    await waitForExpression(cdp, "document.querySelector('.composer-html-source').value.includes('Better Email Support')");
    await clickButton(cdp, '保存草稿', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.body.innerText.includes('草稿已保存') || document.body.innerText.includes('1 草稿')");

    await clickButton(cdp, '写邮件');
    await fillInput(cdp, '.composer input[placeholder=\"收件人\"]', 'ada@example.com');
    await fillInput(cdp, '.composer input[placeholder=\"主题\"]', 'Smoke Outbox Flow');
    await fillInput(cdp, '.composer textarea[placeholder=\"正文\"]', '发件箱排队路径验证');
    await clickButton(cdp, '发件箱', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.body.innerText.includes('邮件已加入发件箱队列')");

    await evalInPage(
      cdp,
      "(() => { const card = [...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Low memory digest')); if (!card) throw new Error('Context menu target message not found'); window.__contextTargetWasUnread = Boolean(card.querySelector('.sender.unread')); card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 320, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('回复') && document.querySelector('.context-menu').innerText.includes('转发') && document.querySelector('.context-menu').innerText.includes('稍后处理') && document.querySelector('.context-menu').innerText.includes('移动到') && document.querySelector('.context-menu').innerText.includes('标签')");
    await evalInPage(
      cdp,
      "(() => { const button = [...document.querySelectorAll('.context-menu button')].find((item) => item.textContent.includes('标为已读') || item.textContent.includes('标为未读')); if (!button) throw new Error('Read-state context action not found'); button.click(); })()",
    );
    await waitForExpression(cdp, "!document.querySelector('.context-menu')");
    await waitForExpression(cdp, "(() => { const card = [...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Low memory digest')); return card && Boolean(card.querySelector('.sender.unread')) !== window.__contextTargetWasUnread; })()");

    await evalInPage(cdp, "(() => { const cards = [...document.querySelectorAll('.message-card')].filter((card) => card.textContent.includes('Low memory digest')); cards.slice(0, 2).forEach((card) => card.querySelector('input[type=\"checkbox\"]').click()); })()");
    await waitForExpression(cdp, "document.body.innerText.includes('已选 2')");
    await evalInPage(
      cdp,
      "(() => { const card = [...document.querySelectorAll('.message-card')].find((item) => item.querySelector('input[type=\"checkbox\"]:checked')); if (!card) throw new Error('Bulk context target not found'); card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 540, clientY: 350, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu-heading')?.innerText.includes('已选择 2 封邮件') && document.querySelector('.context-menu')?.innerText.includes('批量归档') && document.querySelector('.context-menu')?.innerText.includes('批量移动到')");
    await evalInPage(
      cdp,
      "(() => { const labels = [...document.querySelectorAll('.context-menu button')].find((item) => item.textContent.includes('批量标签')); if (!labels) throw new Error('Bulk labels submenu not found'); labels.focus(); labels.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); })()",
    );
    await waitForExpression(cdp, "document.activeElement?.closest('.context-submenu') && document.activeElement?.textContent?.trim().length > 0");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "!document.querySelector('.context-menu')");
    await openDetails(cdp, '.bulk-more-menu');
    await clickButton(cdp, '星标', "document.querySelector('.bulk-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已批量添加星标 2 封邮件')");

    await evalInPage(cdp, "(() => { const cards = [...document.querySelectorAll('.message-card')].filter((card) => card.textContent.includes('Low memory digest')).slice(2, 4); cards.forEach((card) => card.querySelector('input[type=\"checkbox\"]').click()); })()");
    await waitForExpression(cdp, "document.body.innerText.includes('已选 2')");
    await openDetails(cdp, '.bulk-more-menu');
    await clickButton(cdp, '工作', "document.querySelector('.bulk-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已批量添加标签 工作：2 封邮件')");

    await evalInPage(
      cdp,
      "(() => { window.__bulkShortcutCount = document.querySelectorAll('.message-card').length; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.bulk-selection span')?.innerText === `已选 ${window.__bulkShortcutCount}`");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "(() => { const status = document.querySelector('.status-line')?.innerText || ''; return !document.querySelector('.bulk-toolbar') && status.includes(`${window.__bulkShortcutCount} 封邮件`) && (status.includes('已批量添加星标') || status.includes('已批量取消星标')); })()");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "document.querySelector('.bulk-selection span')?.innerText === `已选 ${window.__bulkShortcutCount}`");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "!document.querySelector('.bulk-toolbar') && document.body.innerText.includes('已取消邮件选择')");

    await clickButton(cdp, '线程', "document.querySelector('.list-control-actions')");
    await waitForExpression(cdp, "document.querySelectorAll('.thread-card').length >= 1 && document.body.innerText.includes('封 · 未读')");
    await evalInPage(cdp, "document.querySelector('.thread-card').click()");
    await waitForExpression(cdp, "document.querySelector('.thread-reader') && document.querySelectorAll('.thread-message').length >= 1");
    await clickButton(cdp, '邮件', "document.querySelector('.list-control-actions')");
    await waitForExpression(cdp, "document.querySelector('.message-list')");

    await openDetails(cdp, '.sidebar-tools');
    await fillInput(cdp, '.custom-folder-form input[placeholder="新建文件夹"]', '客户跟进');
    await clickButton(cdp, '添加', "document.querySelector('.custom-folder-form')");
    await waitForExpression(cdp, "document.body.innerText.includes('已创建文件夹：客户跟进')");
    await openDetails(cdp, '.more-mailboxes');
    await waitForExpression(cdp, "document.querySelector('.more-mailboxes').innerText.includes('客户跟进')");
    await evalInPage(
      cdp,
      "(() => { const folder = [...document.querySelectorAll('.folder')].find((item) => item.textContent.includes('客户跟进')); if (!folder) throw new Error('Folder context target not found'); folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 420, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('删除文件夹')");
    await clickButton(cdp, '重命名', "document.querySelector('.context-menu')");
    await fillInput(cdp, '.folder-rename input', '重点客户');
    await clickButton(cdp, '保存', "document.querySelector('.folder-rename')");
    await waitForExpression(cdp, "document.body.innerText.includes('已重命名文件夹：重点客户') && document.body.innerText.includes('重点客户')");
    await evalInPage(cdp, `(() => {
      const card = [...document.querySelectorAll('.message-card')]
        .find((item) => item.textContent.includes('Quarterly update'));
      const folder = [...document.querySelectorAll('.folder')]
        .find((item) => item.textContent.includes('重点客户'));
      if (!card || !folder) throw new Error('Message drag source or folder target not found');
      const data = new DataTransfer();
      window.__messageDragData = data;
      window.__messageDragCard = card;
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
      folder.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    })()`);
    await waitForExpression(cdp, "document.querySelector('.message-card.dragging') && document.querySelector('.folder.message-drop-target')?.textContent.includes('重点客户')");
    await evalInPage(cdp, `(() => {
      const folder = [...document.querySelectorAll('.folder')]
        .find((item) => item.textContent.includes('重点客户'));
      if (!folder || !window.__messageDragData) throw new Error('Message drop target not ready');
      folder.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__messageDragData,
      }));
      window.__messageDragCard?.dispatchEvent(new DragEvent('dragend', {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__messageDragData,
      }));
    })()`);
    await waitForExpression(cdp, "document.body.innerText.includes('已拖动到 重点客户：1 封邮件') && document.querySelector('.undo-snackbar')");
    await clickButton(cdp, '重点客户', "document.querySelector('.more-mailboxes')");
    await waitForExpression(cdp, "document.body.innerText.includes('Quarterly update')");
    await clickButton(cdp, '撤销', "document.querySelector('.undo-snackbar')");
    await waitForExpression(cdp, "document.body.innerText.includes('已撤销：移动到 重点客户') && document.body.innerText.includes('Quarterly update')");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((button) => button.textContent.includes('安全检查清单')).click()");
    await waitForExpression(cdp, "document.querySelector('.reader-more-menu') && !document.body.innerText.includes('导出 EML')");
    await openDetails(cdp, '.reader-more-menu');
    await waitForExpression(cdp, "[...document.querySelectorAll('.reader-more-menu button')].some((item) => item.textContent.includes('重点客户'))");
    await clickButton(cdp, '重点客户', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已移动到 重点客户')");
    await openDetails(cdp, '.more-mailboxes');
    await clickButton(cdp, '重点客户', "document.querySelector('.more-mailboxes')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await evalInPage(cdp, "document.querySelector('.reader-actions button[aria-label=\"删除\"]').click()");
    await waitForExpression(cdp, "document.body.innerText.includes('本地已移动')");
    await openDetails(cdp, '.more-mailboxes');
    await clickButton(cdp, '废纸篓', "document.querySelector('.more-mailboxes')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单') && document.querySelector('.reader-actions').innerText.includes('恢复')");
    await openDetails(cdp, '.reader-more-menu');
    await waitForExpression(cdp, "[...document.querySelectorAll('.reader-more-menu button')].some((item) => item.textContent.includes('永久删除'))");
    await evalInPage(cdp, "document.querySelector('.reader-more-menu').open = false");
    await clickButton(cdp, '恢复', "document.querySelector('.reader-actions')");
    await waitForExpression(cdp, "document.body.innerText.includes('已恢复到收件箱')");
    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '标为垃圾邮件', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已标为垃圾邮件')");
    await openDetails(cdp, '.more-mailboxes');
    await clickButton(cdp, '垃圾邮件', "document.querySelector('.more-mailboxes')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单') && document.body.innerText.includes('不是垃圾邮件')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '不是垃圾邮件', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已移回收件箱，并标记为不是垃圾邮件')");
    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");

    await evalInPage(cdp, "document.querySelector('.account-switcher-trigger').click()");
    await waitForExpression(cdp, "document.querySelector('[data-context-item=\"account-scope-2\"]')");
    await evalInPage(cdp, "document.querySelector('[data-context-item=\"account-scope-2\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.account-switcher[data-account-scope=\"2\"]')?.innerText.includes('design@better-email.local') && document.querySelector('.account-switcher[data-account-scope=\"2\"]')?.innerText.includes('iCloud')");
    await clickButton(cdp, '设置');
    await waitForExpression(cdp, "document.body.innerText.includes('账号设置') && document.body.innerText.includes('服务商兼容性与真实验证')");
    await openDetails(cdp, '.settings-disclosure[data-settings-section=\"backup\"]');
    await clickButton(cdp, '连接测试', "document.querySelector('.settings-action-bar')");
    await waitForExpression(cdp, "document.querySelector('.settings-connection-report')?.innerText.includes('imap.mail.me.com:993') && document.querySelector('.settings-connection-report')?.innerText.includes('smtp.mail.me.com:587')");
    await waitForExpression(cdp, "document.querySelector('select[aria-label=\"撤销发送延迟\"]').value === '10'");
    await selectValue(cdp, 'select[aria-label="撤销发送延迟"]', '5');
    await waitForExpression(cdp, "localStorage.getItem('better-email.sendUndoDelaySeconds') === '5' && document.querySelector('.settings-send-panel').innerText.includes('5 秒')");
    await openDetails(cdp, '.settings-disclosure[data-settings-section=\"providers\"]');
    await waitForExpression(cdp, "document.body.innerText.includes('兼容性矩阵')");
    await openDetails(cdp, '.settings-disclosure[data-settings-section=\"sync\"]');
    await waitForExpression(cdp, "document.body.innerText.includes('同步调度与限流') && document.body.innerText.includes('每轮最多 2 个账号') && document.body.innerText.includes('Smoke Outbox Flow') && document.body.innerText.includes('排队中')");
    await clickButton(cdp, '发现文件夹', "document.querySelector('.settings-imap-discovery')");
    await waitForExpression(cdp, "document.querySelector('.settings-imap-discovery')?.innerText.includes('design@better-email.local') && document.querySelector('.settings-imap-discovery')?.innerText.includes('3 个')");
    await clickButton(cdp, '演练', "document.querySelector('.settings-sync-panel')");
    await waitForExpression(cdp, "document.querySelector('.settings-sync-panel')?.innerText.includes('design@better-email.local')");
    await waitForExpression(cdp, "document.body.innerText.includes('静音账号') && document.body.innerText.includes('重点账号') && document.querySelector('.notification-account-grid')");
    await openDetails(cdp, '.settings-disclosure[data-settings-section=\"backup\"]');
    await clickButton(cdp, '导入 EML');
    await waitForExpression(cdp, "document.body.innerText.includes('已导入 EML：Imported EML Sample') && document.body.innerText.includes('Imported EML Sample')");
    await clickButton(cdp, '导出本地备份');
    await waitForExpression(cdp, "document.body.innerText.includes('/tmp/better-email-backup.json') && document.body.innerText.includes('凭据未包含')");

    await clickButton(cdp, '编辑', "document.querySelector('.contact-tool-row')");
    await fillInput(cdp, '.contact-edit-form input[placeholder=\"联系人名称\"]', 'Ada Lovelace');
    await fillInput(cdp, '.contact-edit-form textarea[placeholder^=\"别名邮箱\"]', 'ada@work.example.com');
    await clickButton(cdp, '保存', "document.querySelector('.contact-edit-form')");
    await waitForExpression(cdp, "document.body.innerText.includes('联系人已更新：Ada Lovelace') && document.body.innerText.includes('Ada Lovelace') && document.body.innerText.includes('别名 1')");
    await clickButton(cdp, '设为 VIP', "document.querySelector('.contact-tool-row')");
    await waitForExpression(cdp, "document.body.innerText.includes('已设为 VIP：Ada Lovelace') && document.querySelector('.contact-tool-row').innerText.includes('★ Ada Lovelace') && document.querySelector('.contact-tool-row').innerText.includes('别名 1') && JSON.parse(localStorage.getItem('better-email.notificationPolicy')).vipSenders.includes('ada@work.example.com')");
    await fillInput(cdp, '.contact-create-form input[placeholder="联系人名称"]', 'Ada Duplicate');
    await fillInput(cdp, '.contact-create-form input[placeholder="邮箱地址"]', 'ada.duplicate@example.com');
    await fillInput(cdp, '.contact-create-form textarea[placeholder^="别名邮箱"]', 'ada@example.com');
    await clickButton(cdp, '新增联系人', "document.querySelector('.contact-create-form')");
    await waitForExpression(cdp, "document.body.innerText.includes('重复联系人建议') && document.body.innerText.includes('Ada Duplicate') && document.body.innerText.includes('邮箱或别名重叠')");
    await clickButton(cdp, '一键合并', "document.querySelector('.contact-suggestion-panel')");
    await waitForExpression(cdp, "document.body.innerText.includes('已按建议合并：Ada Duplicate') && !document.querySelector('.settings-modal').innerText.includes('ada.duplicate@example.com')");
    await fillInput(cdp, '.contact-create-form input[placeholder="联系人名称"]', 'Merge Source');
    await fillInput(cdp, '.contact-create-form input[placeholder="邮箱地址"]', 'merge-source@example.com');
    await fillInput(cdp, '.contact-create-form textarea[placeholder^="别名邮箱"]', 'merge.alias@example.com');
    await clickButton(cdp, '新增联系人', "document.querySelector('.contact-create-form')");
    await waitForExpression(cdp, "document.body.innerText.includes('联系人已新增：Merge Source') && document.body.innerText.includes('merge-source@example.com')");
    await selectOptionByText(cdp, '.contact-merge-picker select', 'merge-source@example.com');
    await clickButton(cdp, '合并', "[...document.querySelectorAll('.contact-tool-row')].find((row) => row.innerText.includes('Ada Lovelace'))");
    await waitForExpression(cdp, "document.body.innerText.includes('已合并联系人：Merge Source') && [...document.querySelectorAll('.contact-tool-row')].find((row) => row.innerText.includes('Ada Lovelace'))?.innerText.includes('别名 4')");
    await fillInput(cdp, '.contact-create-form input[placeholder="联系人名称"]', 'Delete Me');
    await fillInput(cdp, '.contact-create-form input[placeholder="邮箱地址"]', 'delete-me@example.com');
    await clickButton(cdp, '新增联系人', "document.querySelector('.contact-create-form')");
    await waitForExpression(cdp, "document.body.innerText.includes('联系人已新增：Delete Me') && document.body.innerText.includes('delete-me@example.com')");
    await clickButton(cdp, '删除', "[...document.querySelectorAll('.contact-tool-row')].find((row) => row.innerText.includes('delete-me@example.com'))");
    await waitForExpression(cdp, "document.body.innerText.includes('联系人已删除：Delete Me') && !document.querySelector('.settings-modal').innerText.includes('delete-me@example.com')");

    await fillInput(cdp, '.rule-editor input[placeholder=\"规则名称\"]', 'Smoke Rule');
    await selectValue(cdp, '.rule-builder select', 'subject');
    await fillInput(cdp, '.rule-builder input[placeholder=\"关键词或邮箱\"]', 'Smoke');
    await selectOptionByText(cdp, '.rule-builder select', '工作', 1);
    await clickButton(cdp, '加星标', "document.querySelector('.rule-action-chips')");
    await waitForExpression(cdp, "document.querySelector('input[aria-label=\"规则条件语法\"]').value === 'subject contains Smoke' && document.querySelector('input[aria-label=\"规则动作语法\"]').value.includes('apply label 工作') && document.querySelector('input[aria-label=\"规则动作语法\"]').value.includes('star')");
    await clickButton(cdp, '新增规则', "document.querySelector('.rule-editor')");
    await waitForExpression(cdp, "document.body.innerText.includes('规则已保存：Smoke Rule') && document.body.innerText.includes('Smoke Rule')");

    await openDetails(cdp, '.settings-disclosure[data-settings-section=\"security-preview\"]');
    await clickButton(cdp, '解析', "document.querySelector('.settings-disclosure[data-settings-section=\"security-preview\"]')");
    await waitForExpression(cdp, "document.querySelector('.settings-disclosure[data-settings-section=\"security-preview\"] .preview-result')?.innerText.includes('安全预览样例') && document.querySelector('.settings-disclosure[data-settings-section=\"security-preview\"] .preview-result')?.innerText.includes('HTML 正文包含 script 标签')");

    await clickButton(cdp, '撤回');
    await waitForExpression(cdp, "document.body.innerText.includes('已撤回到草稿箱') && document.body.innerText.includes('已撤回')");

    await evalInPage(cdp, "[...document.querySelectorAll('.settings-modal header button')].find((button) => button.textContent.includes('关闭')).click()");
    await evalInPage(cdp, "document.querySelector('.account-switcher-trigger').click()");
    await waitForExpression(cdp, "document.querySelector('[data-context-item=\"account-scope-all\"]')");
    await evalInPage(cdp, "document.querySelector('[data-context-item=\"account-scope-all\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.account-switcher[data-account-scope=\"all\"]')?.innerText.includes('统一邮箱')");

    await clickButton(cdp, '写邮件');
    await fillInput(cdp, '.composer input[placeholder=\"收件人\"]', 'ada@example.com');
    await fillInput(cdp, '.composer input[placeholder=\"主题\"]', 'Smoke Undo Send');
    await fillInput(cdp, '.composer textarea[placeholder=\"正文\"]', '撤销发送路径验证');
    await clickButton(cdp, '发送', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.querySelector('.send-undo-snackbar')?.innerText.includes('5 秒后发送') && document.querySelector('.send-undo-snackbar')?.innerText.includes('Smoke Undo Send')");
    await clickButton(cdp, '撤回发送', "document.querySelector('.send-undo-snackbar')");
    await waitForExpression(cdp, "!document.querySelector('.send-undo-snackbar') && document.body.innerText.includes('已撤回发送：Smoke Undo Send')");
    await clickButton(cdp, '草稿', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('Smoke Undo Send')");

    await clickButton(cdp, '写邮件');
    await fillInput(cdp, '.composer input[placeholder=\"收件人\"]', 'ada@example.com');
    await fillInput(cdp, '.composer input[placeholder=\"主题\"]', 'Smoke Auto Send');
    await fillInput(cdp, '.composer textarea[placeholder=\"正文\"]', '延迟发送到期路径验证');
    await clickButton(cdp, '发送', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.querySelector('.send-undo-snackbar')?.innerText.includes('Smoke Auto Send')");
    await waitForExpression(cdp, "!document.querySelector('.send-undo-snackbar') && document.body.innerText.includes('SMTP 发件箱发送完成')", 12_000);
    await clickButton(cdp, '已发送', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('Smoke Auto Send')");
    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");

    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((button) => button.textContent.includes('安全检查清单')).click()");
    await evalInPage(cdp, "document.querySelector('.reader-actions button[aria-label=\"归档\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.undo-snackbar') && document.body.innerText.includes('归档') && document.body.innerText.includes('撤销')");
    await evalInPage(
      cdp,
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }))",
    );
    await waitForExpression(cdp, "document.body.innerText.includes('已撤销：归档') && document.body.innerText.includes('安全检查清单')");
    await fillInput(cdp, '.quick-reply textarea', '收到，我会继续跟进。');
    await clickButton(cdp, '发送回复', "document.querySelector('.quick-reply')");
    await waitForExpression(cdp, "document.body.innerText.includes('已快速回复') && document.querySelector('.quick-reply textarea').value === ''");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '稍后处理', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已稍后处理到') && document.body.innerText.includes('取消稍后')");
    await openDetails(cdp, '.more-mailboxes');
    await clickButton(cdp, '稍后处理', "document.querySelector('.more-mailboxes')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单') && document.body.innerText.includes('稍后到')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '取消稍后', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已取消稍后处理') && document.body.innerText.includes('安全检查清单')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '导出 EML', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('邮件已导出为 /tmp/安全检查清单.eml')");
    await openDetails(cdp, 'article .label-menu');
    await clickButton(cdp, '重要', "document.querySelector('article .label-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已移除标签：重要')");
    await openDetails(cdp, 'article .label-menu');
    await clickButton(cdp, '重要', "document.querySelector('article .label-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已添加标签：重要') && document.querySelector('article .label-menu button.active')");
    await clickButton(cdp, '下载');
    await waitForExpression(cdp, "document.body.innerText.includes('附件已下载：security-checklist.pdf') && document.body.innerText.includes('打开')");
    await openDetails(cdp, '.reader-warning-actions');
    await clickButton(cdp, '阻止该发件人', "document.querySelector('.reader-warning-actions')");
    await waitForExpression(cdp, "document.body.innerText.includes('已阻止发件人：security@example.com') && document.body.innerText.includes('垃圾邮件')");
    await openDetails(cdp, '.more-mailboxes');
    await clickButton(cdp, '垃圾邮件', "document.querySelector('.more-mailboxes')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((button) => button.textContent.includes('安全检查清单')).click()");
    await waitForExpression(cdp, "document.querySelector('.reader-more-menu') && document.querySelector('.reader-more-menu').textContent.includes('信任该发件人')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '信任该发件人', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已信任发件人远程图片') || document.querySelector('.reader-html img[src=\"https://cdn.example.com/open.png\"]')");

    if (checks.some((ok) => !ok)) throw new Error(`UI smoke checks failed: ${JSON.stringify(checks)}`);

    const report = {
      status: 'ok',
      url,
      assertions: [
        'main shell rendered',
        'Better Email brand mark rendered',
        'legacy SwiftMail settings migrate to better-email keys',
        'resizable panes persist and reset',
        'modern account switcher menu works',
        'more mailbox list stays inside sidebar',
        'favorite mailbox pin persists and can be removed',
        'folder context menu marks all messages read',
        'folder context menu empties trash',
        'shortcut help opens from button and keyboard',
        'command palette opens and runs commands',
        'message list loaded',
        'reader warning displayed',
        'search works',
        'saved search shortcuts work',
        'contact center search and compose works',
        'contact context menu opens editor',
        'contact command palette compose works',
        'recipient autocomplete works',
        'composer advanced tools stay folded by default',
        'composer autosave restores after reload',
        'composer templates save and insert',
        'composer attachment chips work',
        'composer drag drop attachments work',
        'composer minimize restore works',
        'composer rich text html works',
        'composer sender identity selector works',
        'composer signature insertion works',
        'composer draft save works',
        'bulk star and label actions work',
        'keyboard select all bulk action and escape clear work',
        'thread view opens conversations',
        'message drag drop move and undo works',
        'custom folder create rename and move works',
        'trash restore flow works',
        'manual spam and not-spam correction works',
        'outbox queue and cancel works',
        'settings modal opens',
        'multi-account diagnostics target selected account',
        'undo send delay settings persist',
        'undo send returns message to drafts',
        'scheduled send automatically flushes to sent',
        'local EML import works',
        'local backup export works',
        'contact create edit suggested merge manual merge delete and VIP sync works',
        'rules create flow works',
        'raw MIME preview works',
        'snooze and unsnooze flow works',
        'global keyboard undo restores archived message',
        'inline quick reply sends from reader',
        'message EML export works',
        'label toggle works',
        'attachment download flow works',
        'blocked sender rule moves message to spam',
        'remote image sender trust re-renders reader',
      ],
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (cdp) cdp.close();
    await stopChild(chrome);
    await stopChild(vite);
    await removeDirWithRetry(profileDir);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
