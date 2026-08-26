import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket as UndiciWebSocket } from 'undici';

function resolveCdpWebSocket() {
  if (typeof globalThis.WebSocket === 'function') {
    return globalThis.WebSocket;
  }
  if (typeof UndiciWebSocket === 'function') {
    return UndiciWebSocket;
  }
  throw new Error(
    '当前运行环境不支持 WebSocket。'
    + '请确认已安装 undici，或在支持 WebSocket 的 Node 版本上运行 npm run test:ui。',
  );
}

const CDPWebSocket = resolveCdpWebSocket();
const CDP_OPEN = typeof CDPWebSocket.OPEN === 'number' ? CDPWebSocket.OPEN : 1;

const root = new URL('..', import.meta.url).pathname;
const port = Number(
  process.env.BETTER_EMAIL_UI_SMOKE_PORT
  ?? process.env.SWIFTMAIL_UI_SMOKE_PORT
  ?? 1430,
);
const url = `http://127.0.0.1:${port}`;
const captureDir = process.env.BETTER_EMAIL_UI_CAPTURE_DIR;
const globalSmokeTimeoutMs = Number(process.env.BETTER_EMAIL_UI_SMOKE_TIMEOUT_MS ?? 30 * 60_000);
const heartbeatMs = Number(process.env.BETTER_EMAIL_UI_SMOKE_HEARTBEAT_MS ?? 30_000);
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'google-chrome',
  'chromium',
  'chrome',
].filter(Boolean);
const startedAt = Date.now();
let stepCounter = 0;
let currentStep = 'startup';
let heartbeatTimer = null;

function formatDuration(ms) {
  const roundedMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(roundedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
}

function shortText(value, limit = 120) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function setStep(label) {
  stepCounter += 1;
  currentStep = `#${stepCounter} ${label}`;
  return currentStep;
}

function assertGlobalTimeout(context = 'progressing') {
  const elapsed = Date.now() - startedAt;
  if (elapsed > globalSmokeTimeoutMs) {
    throw new Error(
      `UI smoke timed out globally after ${formatDuration(elapsed)} (limit ${formatDuration(globalSmokeTimeoutMs)}): ${context}`,
    );
  }
}

async function withStep(label, action) {
  const stepLabel = setStep(label);
  const start = Date.now();
  console.log(`[ui-smoke] START ${stepLabel}`);
  assertGlobalTimeout(stepLabel);
  try {
    const result = await action();
    console.log(`[ui-smoke] DONE ${stepLabel} in ${formatDuration(Date.now() - start)}`);
    return result;
  } catch (error) {
    const message = error?.message ?? String(error);
    throw new Error(`Step failed (${stepLabel}): ${message}`);
  }
}

function startWatchdog() {
  heartbeatTimer = setInterval(() => {
    console.log(`[ui-smoke] heartbeat elapsed=${formatDuration(Date.now() - startedAt)} current=${currentStep}`);
  }, heartbeatMs);
  heartbeatTimer.unref();
}

function stopWatchdog() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

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

async function waitForHttp(target, timeoutMs = 15_000, expectedChild = null) {
  return withStep(`waitForHttp ${target}`, async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertGlobalTimeout(`waiting for ${target}`);
      if (expectedChild && expectedChild.exitCode !== null) {
        throw new Error(`Expected server process exited before ${target} became ready (code=${expectedChild.exitCode}, signal=${expectedChild.signalCode ?? 'none'})`);
      }
      let response;
      try {
        response = await fetch(target);
      } catch {
        // Server is still starting.
      }
      if (response?.ok) {
        if (expectedChild && expectedChild.exitCode !== null) {
          throw new Error(`Expected server process exited before ${target} became ready (code=${expectedChild.exitCode}, signal=${expectedChild.signalCode ?? 'none'})`);
        }
        return;
      }
      await sleep(200);
    }
    throw new Error(`Timed out waiting for ${target}`);
  });
}

async function findChrome() {
  return withStep('findChrome', async () => {
    for (const candidate of chromeCandidates) {
      const child = spawn(candidate, ['--version'], { stdio: 'ignore' });
      const code = await new Promise((resolve) => child.once('exit', resolve));
      if (code === 0) return candidate;
    }
    throw new Error('Chrome/Chromium executable not found; set CHROME_PATH to run UI smoke tests.');
  });
}

async function chromeJson(debugPort, path) {
  return withStep(`chromeJson ${path}`, async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
    if (!response.ok) throw new Error(`Chrome CDP request failed: ${path}`);
    return response.json();
  });
}

async function openCdp(debugPort, pageUrl) {
  return withStep(`openCdp ${pageUrl}`, async () => {
    const deadline = Date.now() + 10_000;
    let target = null;
    while (Date.now() < deadline) {
      assertGlobalTimeout(`waiting for CDP target ${pageUrl}`);
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
    const ws = new CDPWebSocket(target.webSocketDebuggerUrl);
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

    function sendOnce(method, params = {}) {
      if (ws.readyState !== CDP_OPEN) {
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

    function send(method, params = {}) {
      return sendWithRetry(sendOnce, method, params);
    }

    return { send, events, close: () => ws.close() };
  });
}

function isTransientCdpError(error) {
  const message = String(error?.message ?? error ?? '');
  return message.includes('Timed out waiting for Chrome CDP response')
    || message.includes('CDP socket');
}

function isTransientPageError(error) {
  const message = String(error?.message ?? error ?? '');
  return message.includes('Cannot read properties of null')
    || message.includes('Cannot read properties of undefined')
    || message.includes('not found');
}

async function sendWithRetry(sendOnce, method, params, retries = 1) {
  let lastError = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sendOnce(method, params);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientCdpError(error)) throw error;
      await sleep(250);
    }
  }
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  return withStep(`waitForExpression ${shortText(expression)}`, async () => {
    const deadline = Date.now() + timeoutMs;
    let lastValue = null;
    while (Date.now() < deadline) {
      assertGlobalTimeout(`waiting for expression ${shortText(expression)}`);
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
  });
}

async function evalInPage(cdp, expression) {
  return withStep(`evalInPage ${shortText(expression)}`, async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assertGlobalTimeout(`eval in page ${shortText(expression)}`);
      if (attempt > 0) await sleep(200);
      try {
        const result = await cdp.send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (result.exceptionDetails) {
          const exception = result.exceptionDetails.exception;
          const description = exception?.description || exception?.value || result.exceptionDetails.text;
          lastError = new Error(description ?? 'Page evaluation failed');
          if (attempt === 0 && isTransientPageError(lastError)) continue;
          throw lastError;
        }
        return result.result?.value;
      } catch (error) {
        if (attempt === 0 && isTransientCdpError(error)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new Error('Page evaluation failed');
  });
}

/**
 * 打开账号切换菜单并等待目标菜单项出现。
 * 切换菜单可能因上次交互遗留而处于已展开/已收起状态：先探测目标项，
 * 不在时点击触发器，短超时等待；仍不出现则重试，消除单次点击被吞的偶发。
 */
async function openAccountSwitcherMenu(cdp, expectSelector) {
  return withStep(`openAccountSwitcherMenu ${expectSelector}`, async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      assertGlobalTimeout(`switching account menu ${expectSelector}`);
      const present = await evalInPage(
        cdp,
        `!!document.querySelector(${JSON.stringify(expectSelector)})`,
      );
      if (present) return;
      await evalInPage(cdp, "(() => { const trigger = document.querySelector('.account-switcher-trigger'); if (!trigger) throw new Error('Account switcher trigger not found'); trigger.click(); })()");
      const appeared = await waitForExpression(
        cdp,
        `!!document.querySelector(${JSON.stringify(expectSelector)})`,
        2500,
      ).catch(() => false);
      if (appeared) return;
    }
    throw new Error(`Account switcher menu did not open for ${expectSelector}`);
  });
}

async function captureScreenshot(cdp, name) {
  return withStep(`captureScreenshot ${name}`, async () => {
    if (!captureDir) return;
    mkdirSync(captureDir, { recursive: true });
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    writeFileSync(join(captureDir, `${name}.png`), result.data, 'base64');
  });
}

async function waitForSettingsPageStable(cdp) {
  return withStep('waitForSettingsPageStable', async () => {
    await waitForExpression(
      cdp,
      "(() => { const page = document.querySelector('.settings-page'); return page && page.getAnimations().every((animation) => animation.playState === 'finished'); })()",
    );
  });
}

async function clickButton(cdp, text, scope = 'document') {
  return withStep(`clickButton ${text}`, async () => {
    await evalInPage(
      cdp,
      `(() => {
        const root = ${scope};
        const button = [...root.querySelectorAll('button')].find((item) => {
          const navLabel = item.querySelector('.settings-nav-label')?.textContent.trim();
          const ariaLabel = item.getAttribute('aria-label');
          const title = item.getAttribute('title');
          return navLabel
            ? navLabel === ${JSON.stringify(text)}
            : item.textContent.includes(${JSON.stringify(text)})
              || ariaLabel === ${JSON.stringify(text)}
              || title === ${JSON.stringify(text)};
        });
        if (!button) throw new Error('Button not found: ${text}');
        button.click();
      })()`,
    );
  });
}

async function closeComposer(cdp) {
  return withStep('closeComposer', async () => {
    await evalInPage(
      cdp,
      "(() => { const composer = document.querySelector('.composer'); if (!composer) return; const button = composer.querySelector('button[aria-label=\"关闭写信窗口\"]') ?? [...composer.querySelectorAll('button')].find((item) => item.textContent.includes('关闭')); if (!button) throw new Error('Composer close button not found'); button.click(); })()",
    );
    await waitForExpression(cdp, "!document.querySelector('.composer') || document.querySelector('.dialog-card')");
    await evalInPage(
      cdp,
      "(() => { const dialog = document.querySelector('.dialog-card'); if (!dialog) return; const button = [...dialog.querySelectorAll('button')].find((item) => item.textContent.includes('舍弃邮件')); if (!button) throw new Error('Discard draft button not found'); button.click(); })()",
    );
    await waitForExpression(cdp, "!document.querySelector('.composer')");
  });
}

async function openCardContextMenu(cdp, subject) {
  return withStep(`openCardContextMenu ${subject}`, async () => {
    await waitForExpression(cdp, `[...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes(${JSON.stringify(subject)}))`);
    await evalInPage(
      cdp,
      `(() => {
        const card = [...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes(${JSON.stringify(subject)}));
        if (!card) throw new Error('Context menu target card not found: ${subject}');
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 320, button: 2 }));
      })()`,
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')");
  });
}

async function clickContextMenuItem(cdp, text) {
  return withStep(`clickContextMenuItem ${text}`, async () => {
    await evalInPage(
      cdp,
      `(() => {
        const button = [...document.querySelectorAll('.context-menu button')].find((item) => item.textContent.includes(${JSON.stringify(text)}));
        if (!button) throw new Error('Context menu item not found: ${text}');
        button.click();
      })()`,
    );
  });
}

async function clickFolderContextMenuItem(cdp, role, text) {
  return withStep(`clickFolderContextMenuItem ${role} -> ${text}`, async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const clicked = await evalInPage(
        cdp,
        `(() => {
          const button = [...document.querySelectorAll('.context-menu button')]
            .find((item) => item.textContent.includes(${JSON.stringify(text)}));
          if (!button) return false;
          button.click();
          return true;
        })()`,
      );
      if (clicked) return;
      await openFolderContextMenu(cdp, role, text);
    }
    throw new Error(`Context menu item did not remain available: ${text}`);
  });
}

async function openFolderContextMenu(cdp, role, text) {
  return withStep(`openFolderContextMenu ${role} -> ${text}`, async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const alreadyOpen = await evalInPage(
        cdp,
        `document.querySelector('.context-menu')?.innerText.includes(${JSON.stringify(text)})`,
      );
      if (alreadyOpen) return;

      const point = await evalInPage(
        cdp,
        `(() => {
          const folder = document.querySelector('.primary-folder-list .folder[data-folder-role=${JSON.stringify(role)}]');
          if (!folder) throw new Error('Folder context menu target not found: ${role}');
          const rect = folder.getBoundingClientRect();
          return { x: rect.left + Math.min(220, Math.max(12, rect.width / 2)), y: rect.top + rect.height / 2 };
        })()`,
      );
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button: 'right',
        buttons: 2,
        clickCount: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button: 'right',
        buttons: 0,
        clickCount: 1,
      });
      try {
        await waitForExpression(
          cdp,
          `document.querySelector('.context-menu')?.innerText.includes(${JSON.stringify(text)})`,
          2500,
        );
        return;
      } catch {
        // The folder may still be settling after a document reload; retry the
        // same real pointer gesture rather than loosening the menu assertion.
      }
    }
    throw new Error(`Folder context menu did not open: ${role} -> ${text}`);
  });
}

async function clickContextSubmenuItem(cdp, branchText, itemText) {
  return withStep(`clickContextSubmenuItem ${branchText} > ${itemText}`, async () => {
    await evalInPage(
      cdp,
      `(() => {
        const branch = [...document.querySelectorAll('.context-menu button')].find((item) => item.textContent.includes(${JSON.stringify(branchText)}));
        if (!branch) throw new Error('Context submenu branch not found: ${branchText}');
        branch.focus();
        branch.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
      })()`,
    );
    await waitForExpression(
      cdp,
      `[...document.querySelectorAll('.context-submenu button')].some((item) => item.textContent.includes(${JSON.stringify(itemText)}))`,
    );
    await evalInPage(
      cdp,
      `(() => {
        const button = [...document.querySelectorAll('.context-submenu button')].find((item) => item.textContent.includes(${JSON.stringify(itemText)}));
        if (!button) throw new Error('Context submenu item not found: ${itemText}');
        button.click();
      })()`,
    );
  });
}

async function openSettingsSection(cdp, label, section, expectedSelector) {
  return withStep(`openSettingsSection ${label}`, async () => {
    await clickButton(cdp, label, "document.querySelector('.settings-nav')");
    await waitForExpression(
      cdp,
      `document.querySelector('.settings-page-header h2')?.textContent.trim() === ${JSON.stringify(label)}
        && document.querySelector('.settings-nav button[aria-current="page"]')?.textContent.includes(${JSON.stringify(label)})
        && document.querySelector(${JSON.stringify(expectedSelector)})
        && [...document.querySelectorAll('[data-settings-section]')]
          .every((item) => item.dataset.settingsSection === ${JSON.stringify(section)}
            || item.dataset.settingsSection.startsWith(${JSON.stringify(section)} + '-'))`,
    );
  });
}

async function openContactCreateDialog(cdp) {
  return withStep('openContactCreateDialog', async () => {
    await clickButton(
      cdp,
      '添加联系人',
      "document.querySelector('.settings-page[data-settings-page=\"contacts\"] .contact-transfer-actions')",
    );
    await waitForExpression(cdp, "document.querySelector('.contact-create-form[role=\"dialog\"]')");
  });
}

async function openDetails(cdp, selector) {
  return withStep(`openDetails ${selector}`, async () => {
    await evalInPage(
      cdp,
      `(() => {
        const details = document.querySelector(${JSON.stringify(selector)});
        if (!details) throw new Error('Details menu not found: ${selector}');
        details.open = true;
        details.dispatchEvent(new Event('toggle', { bubbles: true }));
      })()`,
    );
  });
}

async function rectDetails(cdp, selector) {
  return evalInPage(
    cdp,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Rect target not found: ${selector}');
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    })()`,
  );
}

async function assertSettingsEdgesAligned(cdp, label, pairName, selectorA, selectorB, tolerance = 1) {
  const rectA = await rectDetails(cdp, selectorA);
  const rectB = await rectDetails(cdp, selectorB);
  const diffLeft = Math.abs(rectA.left - rectB.left);
  const diffRight = Math.abs(rectA.right - rectB.right);
  console.log(`${label}: ${pairName} leftDiff=${diffLeft.toFixed(3)}px rightDiff=${diffRight.toFixed(3)}px`);
  if (diffLeft > tolerance || diffRight > tolerance) {
    throw new Error(
      `${label}: ${pairName} edges misaligned (leftDiff=${diffLeft.toFixed(3)}px rightDiff=${diffRight.toFixed(3)}px); rectA=${JSON.stringify(rectA)} rectB=${JSON.stringify(rectB)}`,
    );
  }
  return { rectA, rectB, diffLeft, diffRight };
}

async function assertSettingsProvidersGeometry(cdp, label) {
  await assertSettingsEdgesAligned(
    cdp,
    label,
    '连接参数卡片 vs 兼容性验证卡片',
    '.settings-page[data-settings-page="providers"] .st-section',
    '.settings-page[data-settings-page="providers"] details[data-settings-section="providers"]',
  );
  const content = await rectDetails(cdp, '.settings-provider-advanced-content');
  const matrix = await rectDetails(cdp, '.settings-provider-matrix');
  const padLeft = Number.parseFloat(content.paddingLeft) || 0;
  const padRight = Number.parseFloat(content.paddingRight) || 0;
  const expectedLeft = content.left + padLeft;
  const expectedRight = content.right - padRight;
  const diffLeft = Math.abs(matrix.left - expectedLeft);
  const diffRight = Math.abs(matrix.right - expectedRight);
  const insideLeft = matrix.left >= expectedLeft - 0.5;
  const insideRight = matrix.right <= expectedRight + 0.5;
  const edgeFit = diffLeft <= 0.5 && diffRight <= 0.5;
  const legacyMargin = Math.max(
    Math.abs(Number.parseFloat(matrix.marginLeft) || 0),
    Math.abs(Number.parseFloat(matrix.marginRight) || 0),
  );
  console.log(`${label}: 兼容性矩阵 insideContent=${insideLeft && insideRight} edgeFit=${edgeFit} diffLeft=${diffLeft.toFixed(3)}px diffRight=${diffRight.toFixed(3)}px expectedLeft=${expectedLeft} expectedRight=${expectedRight} legacyMargin=${legacyMargin}px content=${JSON.stringify(content)} matrix=${JSON.stringify(matrix)}`);
  if (!insideLeft || !insideRight || !edgeFit || legacyMargin > 0.5) {
    throw new Error(
      `${label}: 兼容性矩阵边缘越界、残留旧外边距或未精确贴边 (insideLeft=${insideLeft} insideRight=${insideRight} edgeFit=${edgeFit} diffLeft=${diffLeft.toFixed(3)}px diffRight=${diffRight.toFixed(3)}px expectedLeft=${expectedLeft} expectedRight=${expectedRight} legacyMargin=${legacyMargin}px); content=${JSON.stringify(content)} matrix=${JSON.stringify(matrix)}`,
    );
  }
}

async function assertSettingsAuthAlignment(cdp, label) {
  await assertSettingsEdgesAligned(
    cdp,
    label,
    '登录方式卡片 vs 授权码引导卡片',
    '.settings-page[data-settings-page="auth"] .st-section',
    '.settings-page[data-settings-page="auth"] .settings-auth-guide',
  );
}

async function assertSettingsAuthOAuth2Alignment(cdp, label) {
  await assertSettingsAuthAlignment(cdp, label);
  await assertSettingsEdgesAligned(
    cdp,
    label,
    '登录方式卡片 vs OAuth2 授权卡片',
    '.settings-page[data-settings-page="auth"] .st-section',
    '.settings-page[data-settings-page="auth"] .settings-oauth-primary',
  );
  await openDetails(cdp, '.settings-oauth-advanced');
  await assertSettingsEdgesAligned(
    cdp,
    label,
    '登录方式卡片 vs OAuth 高级详情卡片',
    '.settings-page[data-settings-page="auth"] .st-section',
    '.settings-page[data-settings-page="auth"] .settings-oauth-advanced',
  );
}

async function probeOAuthResultCards(cdp) {
  return evalInPage(
    cdp,
    `(() => {
      const cardEls = [...document.querySelectorAll('.settings-oauth-result')];
      const readCard = (el) => {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
          display: cs.display,
          gap: cs.gap,
          paddingTop: cs.paddingTop,
          paddingRight: cs.paddingRight,
          paddingBottom: cs.paddingBottom,
          paddingLeft: cs.paddingLeft,
          borderWidth: cs.borderWidth,
          borderColor: cs.borderColor,
          borderRadius: cs.borderRadius,
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          fontStyle: cs.fontStyle,
          whiteSpace: cs.whiteSpace,
          overflowX: cs.overflowX,
          overflowY: cs.overflowY,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };
      };
      const cards = cardEls.map(readCard);
      const first = cardEls[0];
      const children = {};
      for (const sel of ['strong', 'span', 'small', 'em']) {
        const el = first?.querySelector(':scope > ' + sel);
        if (!el) { children[sel] = null; continue; }
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        children[sel] = {
          rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
          display: cs.display,
          color: cs.color,
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          fontStyle: cs.fontStyle,
          whiteSpace: cs.whiteSpace,
          overflowX: cs.overflowX,
          overflowY: cs.overflowY,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };
      }
      const page = document.querySelector('.settings-page');
      const pageContent = document.querySelector('.settings-page-content');
      const content = document.querySelector('.settings-content');
      return {
        cardCount: cardEls.length,
        hasLegacyClass: !!document.querySelector('.oauth-result'),
        cards,
        children,
        page: page
          ? { scrollWidth: page.scrollWidth, clientWidth: page.clientWidth }
          : null,
        pageContent: pageContent
          ? (() => { const r = pageContent.getBoundingClientRect(); return { left: r.left, right: r.right }; })()
          : null,
        content: content
          ? { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth }
          : null,
      };
    })()`,
  );
}

async function assertOAuthResultCardGeometry(cdp, label) {
  const data = await probeOAuthResultCards(cdp);
  console.log(`${label}: ${JSON.stringify(data)}`);
  const failures = [];
  if (data.cardCount !== 4) failures.push(`cardCount=${data.cardCount}`);
  if (data.hasLegacyClass) failures.push('legacy .oauth-result present');
  if (!data.cards.every((card) => card.scrollWidth <= card.clientWidth)) failures.push('card horizontal overflow');
  if (data.page && data.page.scrollWidth > data.page.clientWidth) failures.push('page horizontal overflow');
  if (data.content && data.content.scrollWidth > data.content.clientWidth) failures.push('content horizontal overflow');
  if (data.pageContent) {
    if (!data.cards.every((card) => card.rect.left >= data.pageContent.left - 1 && card.rect.right <= data.pageContent.right + 1)) {
      failures.push('card outside page content area');
    }
  }
  const first = data.cards[0];
  if (first) {
    if (first.display !== 'grid') failures.push(`container display=${first.display}`);
    if (first.gap !== '3px') failures.push(`container gap=${first.gap}`);
    if (!(first.paddingTop === '10px' && first.paddingRight === '12px' && first.paddingBottom === '10px' && first.paddingLeft === '12px')) {
      failures.push(`container padding=${first.paddingTop}/${first.paddingRight}/${first.paddingBottom}/${first.paddingLeft}`);
    }
  }
  const expectedChildren = {
    strong: { fontSize: '14px', fontWeight: '580', fontStyle: 'normal' },
    span: { fontSize: '13px', fontWeight: '400', fontStyle: 'normal' },
    small: { fontSize: '13px', fontWeight: '400', fontStyle: 'normal' },
    em: { fontSize: '13px', fontWeight: '400', fontStyle: 'normal' },
  };
  for (const [sel, exp] of Object.entries(expectedChildren)) {
    const child = data.children[sel];
    if (!child) { failures.push(`child ${sel} missing`); continue; }
    if (child.fontSize !== exp.fontSize) failures.push(`${sel} fontSize=${child.fontSize}`);
    if (child.fontWeight !== exp.fontWeight) failures.push(`${sel} fontWeight=${child.fontWeight}`);
    if (child.fontStyle !== exp.fontStyle) failures.push(`${sel} fontStyle=${child.fontStyle}`);
    if (child.scrollWidth > child.clientWidth) failures.push(`${sel} horizontal overflow`);
  }
  if (failures.length > 0) {
    throw new Error(`${label}: oauth result card contract violated (${failures.join('; ')}); data=${JSON.stringify(data)}`);
  }
}

async function assertSettingsNoHorizontalOverflow(cdp, label) {
  const metrics = await evalInPage(
    cdp,
    `(() => {
      const content = document.querySelector('.settings-content');
      if (!content) throw new Error('Settings content not found');
      return { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth };
    })()`,
  );
  console.log(`${label}: settings-content scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`);
  if (metrics.scrollWidth > metrics.clientWidth) {
    throw new Error(`${label}: settings content overflows horizontally: ${JSON.stringify(metrics)}`);
  }
}

async function assertSettingsV2LayoutContract(cdp, label, viewport) {
  const data = await evalInPage(
    cdp,
    `(() => {
      const out = { viewport: { width: window.innerWidth, height: window.innerHeight } };
      const pick = (name, selector, props) => {
        const el = document.querySelector(selector);
        if (!el) { out[name] = null; return; }
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const style = {};
        for (const p of props) style[p] = cs[p];
        out[name] = { rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }, style };
      };
      pick('modal', '.settings-modal', ['display', 'flexDirection', 'width', 'height', 'borderRadius', 'overflow']);
      pick('mainHeader', '.settings-main-header', ['display', 'position', 'minHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundColor']);
      pick('nav', '.settings-nav', ['display', 'flexDirection', 'width', 'borderRightWidth']);
      pick('content', '.settings-content', ['display', 'paddingTop', 'paddingBottom', 'overflow']);
      pick('page', '.settings-page', ['display', 'width', 'overflowY']);
      pick('pageHeader', '.settings-page-header', ['display', 'position', 'minHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundColor']);
      pick('mobileToolbar', '.settings-mobile-toolbar', ['display', 'position']);
      pick('pageContent', '.settings-page-content', ['display', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']);
      const content = document.querySelector('.settings-content');
      if (content) {
        out.contentOverflow = { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth };
      }
      out.pageData = document.querySelector('.settings-page')?.dataset.settingsPage ?? null;
      return out;
    })()`,
  );
  const failures = [];
  const rect = (name) => data[name]?.rect ?? null;
  const style = (name, prop) => data[name]?.style?.[prop] ?? null;
  if (!data.modal) failures.push('modal missing');
  if (viewport === 'desktop') {
    if (data.nav && style('nav', 'display') !== 'flex') failures.push(`nav display=${style('nav', 'display')}`);
    if (data.mobileToolbar && style('mobileToolbar', 'display') !== 'none') failures.push(`mobileToolbar display=${style('mobileToolbar', 'display')}`);
    if (data.mainHeader && style('mainHeader', 'minHeight') !== '52px') failures.push(`mainHeader minHeight=${style('mainHeader', 'minHeight')}`);
    if (data.mainHeader && style('mainHeader', 'position') !== 'sticky') failures.push(`mainHeader position=${style('mainHeader', 'position')}`);
    if (data.pageHeader && style('pageHeader', 'minHeight') !== '78px') failures.push(`pageHeader minHeight=${style('pageHeader', 'minHeight')}`);
    if (data.content && style('content', 'paddingTop') !== '0px') failures.push(`content paddingTop=${style('content', 'paddingTop')}`);
    if (data.content && style('content', 'paddingBottom') !== '0px') failures.push(`content paddingBottom=${style('content', 'paddingBottom')}`);
    const m = rect('modal');
    if (m && m.width > 1081) failures.push(`modal width=${m.width}`);
  } else if (viewport === 'narrow') {
    if (data.nav && style('nav', 'display') === 'flex') failures.push('nav visible on narrow');
    if (data.mobileToolbar && style('mobileToolbar', 'display') !== 'block') failures.push(`mobileToolbar display=${style('mobileToolbar', 'display')}`);
    const m = rect('modal');
    if (m && Math.abs(m.width - data.viewport.width) > 1) failures.push(`modal width=${m.width} vs viewport=${data.viewport.width}`);
  }
  if (data.contentOverflow && data.contentOverflow.scrollWidth > data.contentOverflow.clientWidth) {
    failures.push(`content horizontal overflow ${JSON.stringify(data.contentOverflow)}`);
  }
  console.log(`${label}: ${JSON.stringify(data)}`);
  if (failures.length > 0) {
    throw new Error(`${label}: layout contract violated (${failures.join('; ')}); data=${JSON.stringify(data)}`);
  }
}

async function assertSettingsPagesEnterable(cdp, label, pages) {
  const failures = [];
  for (const page of pages) {
    const state = await evalInPage(
      cdp,
      `(() => {
        const label = ${JSON.stringify(page.label)};
        let button = null;
        if (${JSON.stringify(page.tab === true)}) {
          button = [...document.querySelectorAll('.settings-connection-tabs button')]
            .find((item) => item.textContent.trim() === label);
        }
        if (!button) {
          button = [...document.querySelectorAll('.settings-nav-section > button')]
            .find((item) => item.textContent.trim() === label);
        }
        if (!button) return { entered: false, reason: 'nav button missing' };
        button.click();
        return { entered: true, label };
      })()`,
    );
    if (!state.entered) { failures.push(`${page.id}: ${state.reason}`); continue; }
    try {
      await waitForExpression(
        cdp,
        `document.querySelector('.settings-page')?.dataset.settingsPage === ${JSON.stringify(page.id)}
          && document.querySelector('.settings-page-header h2')?.textContent.trim() === ${JSON.stringify(page.headerLabel ?? page.label)}`,
      );
    } catch (error) {
      const probe = await evalInPage(
        cdp,
        `(() => ({
          modalOpen: !!document.querySelector('.settings-modal'),
          page: document.querySelector('.settings-page')?.dataset.settingsPage ?? null,
          header: document.querySelector('.settings-page-header h2')?.textContent.trim() ?? null,
          navButtons: [...document.querySelectorAll('.settings-nav-section > button')].map((b) => b.textContent.trim()),
          tabs: [...document.querySelectorAll('.settings-connection-tabs button')].map((b) => b.textContent.trim()),
        }))()`,
      );
      throw new Error(`${label}: ${page.id} navigation timed out; state=${JSON.stringify(probe)}; original=${error.message}`);
    }
    await waitForSettingsPageStable(cdp);
    const pageState = await evalInPage(
      cdp,
      `(() => {
        const page = document.querySelector('.settings-page');
        const rect = page?.getBoundingClientRect();
        const style = page ? getComputedStyle(page) : null;
        return {
          id: page?.dataset.settingsPage ?? null,
          title: document.querySelector('.settings-page-header h2')?.textContent.trim() ?? null,
          rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
          overflowY: style?.overflowY ?? null,
          scrollWidth: page?.scrollWidth ?? null,
          clientWidth: page?.clientWidth ?? null,
        };
      })()`,
    );
    console.log(`${label}: ${page.id} page=${JSON.stringify(pageState)}`);
    if (pageState.id !== page.id || pageState.title !== (page.headerLabel ?? page.label)) {
      failures.push(`${page.id}: entered but state mismatch ${JSON.stringify(pageState)}`);
    }
    if (pageState.rect && pageState.rect.width < 100) {
      failures.push(`${page.id}: page too narrow ${JSON.stringify(pageState.rect)}`);
    }
    if (pageState.scrollWidth != null && pageState.scrollWidth > pageState.clientWidth + 1) {
      failures.push(`${page.id}: page horizontal overflow ${JSON.stringify(pageState)}`);
    }
  }
  if (failures.length > 0) throw new Error(`${label}: page enterability failed (${failures.join('; ')})`);
}

async function fillInput(cdp, selector, value, index = 0) {
  return withStep(`fillInput ${selector} ${shortText(value)}`, async () => {
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
  });
}

async function selectValue(cdp, selector, value, index = 0) {
  return withStep(`selectValue ${selector} -> ${shortText(value)}`, async () => {
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
  });
}

async function fillComposerBody(cdp, value) {
  return withStep(`fillComposerBody ${shortText(value)}`, async () => {
    const richReady = await evalInPage(
      cdp,
      "(() => { const rich = document.querySelector('.composer-richtext-body'); if (!rich) return false; rich.focus(); rich.innerHTML = ''; return true; })()",
    );
    if (richReady) {
      // Input.insertText dispatches the same editable input path without
      // relying on the deprecated document.execCommand API, which can hang
      // Chrome's Runtime.evaluate on long-running smoke sessions.
      await cdp.send('Input.insertText', { text: value });
      await sleep(100);
      return;
    }
    await evalInPage(
      cdp,
      `(() => {
        const plain = document.querySelector('.composer textarea[placeholder="正文"]');
        if (!plain) throw new Error('Composer body field not found');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter.call(plain, ${JSON.stringify(value)});
        plain.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    await sleep(100);
  });
}

async function composerBodyHasText(cdp, fragment) {
  return evalInPage(
    cdp,
    `(() => {
      const rich = document.querySelector('.composer-richtext-body');
      if (rich) return (rich.textContent ?? '').includes(${JSON.stringify(fragment)});
      const plain = document.querySelector('.composer textarea[placeholder="正文"]');
      return Boolean(plain && (plain.value ?? '').includes(${JSON.stringify(fragment)}));
    })()`,
  );
}

async function pickCustomSelect(cdp, summarySelector, optionText) {
  return withStep(`pickCustomSelect ${shortText(summarySelector)} -> ${shortText(optionText)}`, async () => {
    await evalInPage(
      cdp,
      `(() => { const summary = document.querySelector(${JSON.stringify(summarySelector)}); if (!summary) throw new Error('Select summary not found: ${summarySelector}'); summary.click(); })()`,
    );
    await waitForExpression(
      cdp,
      `[...document.querySelectorAll('.custom-select-dropdown button[role="option"]')].some((item) => item.textContent.includes(${JSON.stringify(optionText)}))`,
    );
    await evalInPage(
      cdp,
      `[...document.querySelectorAll('.custom-select-dropdown button[role="option"]')].find((item) => item.textContent.includes(${JSON.stringify(optionText)})).click()`,
    );
  });
}

async function selectOptionByText(cdp, selector, text, index = 0) {
  return withStep(`selectOptionByText ${selector} -> ${shortText(text)}`, async () => {
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
      })()` ,
    );
  });
}

async function dragElement(cdp, selector, deltaX) {
  return withStep(`dragElement ${selector} ${deltaX}`, async () => {
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
  });
}

const composeReferenceContacts = [
  { name: '李俊（东华）', email: 'lij140@chinatelecom.cn' },
  { name: '吕东原', email: 'lvdy@chinatelecom.cn' },
  { name: '', email: '006973@chinatelecom.cn' },
  { name: '', email: '1364381330@qq.com' },
  { name: '', email: '419763500@qq.com' },
  { name: '', email: '424299903@qq.com' },
  { name: '', email: '42499903@qq.com' },
];
const COMPOSE_CONTACTS_WIDTH = 304;

async function setUiViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitForExpression(cdp, `window.innerWidth === ${width} && window.innerHeight === ${height}`);
}

async function installFixedComposeClock(cdp) {
  const source = `(() => {
    const NativeDate = window.Date;
    const fixedTime = NativeDate.parse('2026-08-26T11:05:00+08:00');
    class BetterEmailFixedDate extends NativeDate {
      constructor(...args) {
        if (args.length === 0) super(fixedTime);
        else if (args.length === 1) super(args[0]);
        else super(...args);
      }
      static now() { return fixedTime; }
    }
    window.Date = BetterEmailFixedDate;
    return new window.Date().toISOString();
  })()`;
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
  await evalInPage(cdp, source);
}

async function seedComposeReferenceContacts(cdp) {
  return withStep('seedComposeReferenceContacts', async () => {
    await clickButton(cdp, '设置', "document.querySelector('.sidebar-footer')");
    await waitForExpression(cdp, "document.querySelector('.settings-modal')");
    await openSettingsSection(cdp, '联系人', 'contacts', '.settings-page[data-settings-page="contacts"]');
    await waitForExpression(cdp, "document.querySelectorAll('.settings-page[data-settings-page=\"contacts\"] .contact-tool-row').length === 0");

    for (const contact of composeReferenceContacts) {
      await openContactCreateDialog(cdp);
      await fillInput(cdp, '.contact-create-form input[placeholder="联系人名称"]', contact.name);
      await fillInput(cdp, '.contact-create-form input[placeholder="name@example.com"]', contact.email);
      await clickButton(cdp, '确认添加', "document.querySelector('.contact-create-form')");
      await waitForExpression(
        cdp,
        `[...document.querySelectorAll('.settings-page[data-settings-page="contacts"] .contact-tool-row')].some((row) => row.innerText.includes(${JSON.stringify(contact.email)}))`,
      );
    }

    await waitForExpression(
      cdp,
      `document.querySelectorAll('.settings-page[data-settings-page="contacts"] .contact-tool-row').length === ${composeReferenceContacts.length}`,
    );
    await evalInPage(cdp, "document.querySelector('.settings-modal header button[aria-label=\"关闭设置\"]')?.click()");
    await waitForExpression(cdp, "!document.querySelector('.settings-modal')");
  });
}

async function commitComposeRecipient(cdp, value, displayName) {
  await evalInPage(cdp, "document.querySelector('.composer input[role=\"combobox\"]')?.focus()");
  await fillInput(cdp, '.composer input[role="combobox"]', value);
  await evalInPage(cdp, "document.querySelector('.composer input[role=\"combobox\"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
  await waitForExpression(
    cdp,
    `[...document.querySelectorAll('.composer-recipient-chip-copy')].some((item) => item.textContent.trim() === ${JSON.stringify(displayName)})`,
  );
}

async function composeLayoutSnapshot(cdp) {
  return evalInPage(cdp, `(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
    const workspace = rect('.composer-workspace');
    const editor = rect('.composer-editor-pane');
    const contacts = rect('.composer-contacts-panel');
    const footer = rect('.composer footer');
    const quick = rect('.composer-footer-main .composer-quick-tools');
    const schedule = rect('.composer-schedule-status');
    const send = rect('.composer-send-split');
    const isVisible = (selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).display !== 'none' : false;
    };
    const field = (selector) => rect(selector)?.height ?? null;
    const noHorizontalScroll = document.documentElement.scrollWidth <= window.innerWidth + 1
      && document.body.scrollWidth <= window.innerWidth + 1;
    const noFooterOverlap = Boolean(quick && schedule && send)
      && quick.right <= schedule.left + 1
      && schedule.right <= send.left + 1
      && footer && quick.top >= footer.top - 1 && quick.bottom <= footer.bottom + 1
      && schedule.top >= footer.top - 1 && schedule.bottom <= footer.bottom + 1
      && send.top >= footer.top - 1 && send.bottom <= footer.bottom + 1;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      editorWidth: editor?.width ?? null,
      contactsWidth: contacts?.width ?? null,
      gap: workspace && editor && contacts ? contacts.left - editor.right : null,
      senderHeight: field('.composer-sender-context'),
      recipientHeight: field('.composer-recipient-field .composer-field-row'),
      subjectHeight: field('.composer-subject-field'),
      toolbarHeight: field('.composer-rich-toolbar'),
      bodyHeight: field('.composer-body-field'),
      footerHeight: footer?.height ?? null,
      contactsRowHeight: field('.composer-contact-row'),
      contactsFooterHeight: field('.composer-contacts-footer') ?? 0,
      scheduleWidth: schedule?.width ?? null,
      sendWidth: send?.width ?? null,
      noHorizontalScroll,
      noFooterOverlap,
      noContactSelectionUI: !document.querySelector('.composer-contacts-footer, .composer-contact-select, .composer-contact-batch, .composer-contact-target-menu'),
      compactSchedule: isVisible('.composer-schedule-label-compact'),
      compactSend: isVisible('.composer-send-label-compact'),
      fullSchedule: isVisible('.composer-schedule-label-full'),
      fullSend: isVisible('.composer-send-label-full'),
      connectedPanes: Boolean(editor && contacts && Math.abs(contacts.left - editor.right) <= 1),
    };
  })()`);
}

async function captureComposeReferenceFixture(cdp) {
  return withStep('captureComposeReferenceFixture', async () => {
    await setUiViewport(cdp, 1188, 769);
    await evalInPage(cdp, "localStorage.removeItem('better-email.composerAutosave'); localStorage.removeItem('swiftmail.composerAutosave'); location.reload()");
    await waitForExpression(cdp, "document.querySelector('.app-shell') && document.body.innerText.includes('Better Email')");
    await waitForExpression(cdp, "!document.querySelector('.composer')");

    await clickButton(cdp, '写邮件');
    await waitForExpression(cdp, "document.querySelector('.composer input[role=\"combobox\"]') && document.querySelector('.composer-contacts-panel')");
    await waitForExpression(cdp, "!document.body.innerText.includes('未输入内容')");
    const emptySnapshot = await composeLayoutSnapshot(cdp);
    if (!emptySnapshot.noHorizontalScroll || !emptySnapshot.connectedPanes || emptySnapshot.contactsWidth < COMPOSE_CONTACTS_WIDTH - 4 || emptySnapshot.contactsWidth > COMPOSE_CONTACTS_WIDTH + 4 || emptySnapshot.gap < -1 || emptySnapshot.gap > 1 || emptySnapshot.footerHeight > 68) {
      throw new Error(`Empty compose geometry contract failed: ${JSON.stringify(emptySnapshot)}`);
    }
    await evalInPage(cdp, "document.querySelector('.composer input[role=\"combobox\"]')?.focus()");
    const focusSnapshot = await evalInPage(cdp, `(() => {
      const input = document.querySelector('.composer input[role="combobox"]');
      const row = input?.closest('.composer-field-row');
      return {
        inputOutline: input ? getComputedStyle(input).outlineStyle : null,
        rowShadow: row ? getComputedStyle(row).boxShadow : null,
      };
    })()`);
    if (focusSnapshot.inputOutline !== 'none' || focusSnapshot.rowShadow === 'none') {
      throw new Error(`Recipient focus contract failed: ${JSON.stringify(focusSnapshot)}`);
    }
    await captureScreenshot(cdp, 'compose-final-empty-1188');
    await closeComposer(cdp);

    await seedComposeReferenceContacts(cdp);
    await installFixedComposeClock(cdp);
    await clickButton(cdp, '写邮件');
    await waitForExpression(cdp, "document.querySelector('.composer-contacts-panel .composer-contact-row') && document.querySelectorAll('.composer-contacts-panel .composer-contact-row').length === 7");
    await commitComposeRecipient(cdp, '崔栗嘉 <lij140@chinatelecom.cn>', '崔栗嘉');
    await commitComposeRecipient(cdp, '代琴 <daiqin@chinatelecom.cn>', '代琴');
    await waitForExpression(cdp, "[...document.querySelectorAll('.composer-contact-row')].some((row) => row.innerText.includes('李俊（东华）') && row.innerText.includes('已添加'))");
    await waitForExpression(cdp, "!document.querySelector('.composer-richtext-body')?.textContent?.trim() && !document.querySelector('.composer textarea[placeholder=\"正文\"]')?.value?.trim()");
    await waitForExpression(cdp, "document.body.innerText.includes('已自动保存') && document.body.innerText.includes('11:05')", 12_000);

    await evalInPage(cdp, "document.querySelector('.composer-send-menu-trigger')?.click()");
    await waitForExpression(cdp, "document.querySelector('.composer-send-menu')");
    await clickButton(cdp, '定时发送…', "document.querySelector('.composer-send-menu')");
    await waitForExpression(cdp, "document.querySelector('.composer-schedule-picker-popover')");
    await captureScreenshot(cdp, 'compose-reference-schedule-menu');
    await evalInPage(cdp, "document.querySelector('.composer-schedule-picker-popover [role=\"gridcell\"][aria-label=\"2026年8月28日\"]')?.click()");
    await evalInPage(cdp, "document.querySelector('.composer-schedule-picker-popover [role=\"combobox\"][aria-label=\"小时\"]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.composer-schedule-time-options')");
    await clickButton(cdp, '09', "document.querySelector('.composer-schedule-time-options')");
    await evalInPage(cdp, "document.querySelector('.composer-schedule-picker-popover [role=\"combobox\"][aria-label=\"分钟\"]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.composer-schedule-time-options')");
    await clickButton(cdp, '00', "document.querySelector('.composer-schedule-time-options')");
    await clickButton(cdp, '确定', "document.querySelector('.composer-schedule-picker-popover')");
    await waitForExpression(cdp, "document.querySelector('.composer-schedule-status') && document.querySelector('.composer-schedule-picker-trigger')?.innerText.includes('8月28日 09:00')");
    await waitForExpression(cdp, "document.body.innerText.includes('已自动保存') && document.body.innerText.includes('11:05')", 12_000);

    const compactSnapshot = await composeLayoutSnapshot(cdp);
    console.log(`[ui-smoke] compose-reference-1188 geometry ${JSON.stringify(compactSnapshot)}`);
    if (!compactSnapshot.noHorizontalScroll || !compactSnapshot.noFooterOverlap || !compactSnapshot.connectedPanes || !compactSnapshot.noContactSelectionUI || compactSnapshot.contactsWidth < COMPOSE_CONTACTS_WIDTH - 4 || compactSnapshot.contactsWidth > COMPOSE_CONTACTS_WIDTH + 4 || compactSnapshot.gap < -1 || compactSnapshot.gap > 1 || compactSnapshot.footerHeight > 68 || !compactSnapshot.compactSchedule || !compactSnapshot.compactSend || compactSnapshot.fullSchedule || compactSnapshot.fullSend) {
      throw new Error(`1188 compose geometry contract failed: ${JSON.stringify(compactSnapshot)}`);
    }
    await captureScreenshot(cdp, 'compose-reference-state-1188');

    await evalInPage(cdp, "(() => { const row = [...document.querySelectorAll('.composer-contact-row')].find((item) => !item.classList.contains('is-added')); const action = row?.querySelector('.composer-contact-add:not(.is-added)'); if (!action) throw new Error('Contact row add action not found'); action.click(); })()");
    await waitForExpression(cdp, "document.querySelectorAll('.composer-contact-row.is-added').length >= 2");
    await waitForExpression(cdp, "!document.querySelector('.composer-contact-select, .composer-contact-batch, .composer-contact-target-menu, .composer-contacts-footer')");
    await captureScreenshot(cdp, 'compose-reference-contact-added');

    await evalInPage(cdp, "document.querySelector('.composer input[role=\"combobox\"]')?.focus()");
    await waitForExpression(cdp, "getComputedStyle(document.querySelector('.composer input[role=\"combobox\"]')).outlineStyle === 'none'");
    await captureScreenshot(cdp, 'compose-reference-recipient-focus');
    await evalInPage(cdp, "document.activeElement?.blur()");

    await setUiViewport(cdp, 1583, 994);
    await sleep(120);
    const wideSnapshot = await composeLayoutSnapshot(cdp);
    console.log(`[ui-smoke] compose-reference-1583 geometry ${JSON.stringify(wideSnapshot)}`);
    if (!wideSnapshot.noHorizontalScroll || !wideSnapshot.noFooterOverlap || !wideSnapshot.connectedPanes || !wideSnapshot.noContactSelectionUI || wideSnapshot.contactsWidth < COMPOSE_CONTACTS_WIDTH - 4 || wideSnapshot.contactsWidth > COMPOSE_CONTACTS_WIDTH + 4 || wideSnapshot.gap < -1 || wideSnapshot.gap > 1 || wideSnapshot.footerHeight > 68 || !wideSnapshot.fullSchedule || !wideSnapshot.fullSend || wideSnapshot.compactSchedule || wideSnapshot.compactSend) {
      throw new Error(`1583 compose geometry contract failed: ${JSON.stringify(wideSnapshot)}`);
    }

    for (const [width, height] of [[1280, 800], [1440, 900]]) {
      await setUiViewport(cdp, width, height);
      await sleep(120);
      const intermediateSnapshot = await composeLayoutSnapshot(cdp);
      console.log(`[ui-smoke] compose-reference-${width} geometry ${JSON.stringify(intermediateSnapshot)}`);
      if (!intermediateSnapshot.noHorizontalScroll || !intermediateSnapshot.noFooterOverlap || !intermediateSnapshot.connectedPanes || intermediateSnapshot.contactsWidth < COMPOSE_CONTACTS_WIDTH - 4 || intermediateSnapshot.contactsWidth > COMPOSE_CONTACTS_WIDTH + 4 || intermediateSnapshot.gap < -1 || intermediateSnapshot.gap > 1 || intermediateSnapshot.footerHeight > 68) {
        throw new Error(`${width} compose geometry contract failed: ${JSON.stringify(intermediateSnapshot)}`);
      }
    }

    await setUiViewport(cdp, 1583, 994);
    await sleep(120);
    await captureScreenshot(cdp, 'compose-reference-state-1583');
  });
}

async function main() {
  const vite = spawnLogged('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    env: { ...process.env, VITE_BETTER_EMAIL_UI_MOCK: '1', VITE_BETTER_EMAIL_SEED_MOCK_DATA: '1' },
  });
  const profileDir = mkdtempSync(join(tmpdir(), 'better-email-ui-smoke-'));
  let chrome;
  let cdp;
  try {
    startWatchdog();
    setStep('main: start smoke flow');
    await waitForHttp(url, 15_000, vite);
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
    await waitForExpression(cdp, "(() => { const shell = document.querySelector('.app-shell'); if (!shell) return false; const style = getComputedStyle(shell); return style.getPropertyValue('--app-sidebar-width').trim() === '278px' && style.getPropertyValue('--app-list-width').trim() === '422px'; })()");
    await waitForExpression(cdp, "JSON.parse(localStorage.getItem('better-email.appLayout.v2')).sidebar === 278 && localStorage.getItem('swiftmail.appLayout.v2') === null");
    await evalInPage(
      cdp,
      "localStorage.setItem('better-email.appLayout.v2', JSON.stringify({ sidebar: 244, list: 388 })); location.reload()",
    );
    await waitForExpression(cdp, "(() => { const shell = document.querySelector('.app-shell'); if (!shell) return false; const style = getComputedStyle(shell); return style.getPropertyValue('--app-sidebar-width').trim() === '244px' && style.getPropertyValue('--app-list-width').trim() === '388px'; })()");

    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length <= 40 && document.querySelectorAll('.message-card').length > 5 && document.querySelector('.message-date-header') && document.body.innerText.includes('已显示 40 封') && document.body.innerText.includes('加载更多')");
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430,
      height: 780,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, "window.innerWidth === 430 && document.querySelector('.app-shell.is-mobile-app .mobile-message-list-panel')");
    await waitForExpression(cdp, "(() => { const list = document.querySelector('.mobile-message-list-panel .message-list'); return list && list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto' && getComputedStyle(list).touchAction === 'pan-y'; })()");
    await evalInPage(cdp, "(() => { const list = document.querySelector('.mobile-message-list-panel .message-list'); if (!list) throw new Error('Mobile message list not found'); list.scrollTop = Math.min(240, list.scrollHeight - list.clientHeight); list.dispatchEvent(new Event('scroll', { bubbles: true })); })()");
    await waitForExpression(cdp, "document.querySelector('.mobile-message-list-panel .message-list')?.scrollTop > 0");
    await evalInPage(cdp, "document.querySelector('.mobile-inbox-actions .mobile-header-icon[aria-label=\"搜索邮件\"]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.mobile-inbox-header--search') && window.history.state?.betterEmailSearch");
    await fillInput(cdp, '.mobile-search-form input[aria-label="搜索邮件"]', 'invoice');
    await evalInPage(cdp, "document.querySelector('.mobile-search-form')?.requestSubmit()");
    await waitForExpression(cdp, "document.querySelector('.mobile-search-form input[aria-label=\"搜索邮件\"]')?.value === 'invoice'");
    await clickButton(cdp, '邮件', "document.querySelector('.mobile-bottom-nav')");
    await waitForExpression(cdp, "!document.querySelector('.mobile-inbox-header--search') && !window.history.state?.betterEmailSearch");
    await evalInPage(cdp, "document.querySelector('.mobile-inbox-actions .mobile-header-icon[aria-label=\"搜索邮件\"]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.mobile-inbox-header--search input[aria-label=\"搜索邮件\"]')?.value === ''");
    await evalInPage(cdp, "document.querySelector('.mobile-inbox-header--search .mobile-header-icon[aria-label=\"关闭搜索\"]')?.click()");
    await waitForExpression(cdp, "!document.querySelector('.mobile-inbox-header--search')");
    await evalInPage(cdp, "document.querySelector('.mobile-inbox-header .mobile-header-icon[aria-label=\"打开邮箱导航\"]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.mobile-mailbox-sheet')");
    await waitForExpression(cdp, "(() => { const scroll = document.querySelector('.mobile-mailbox-scroll'); return scroll && getComputedStyle(scroll).overflowY === 'auto'; })()");
    await evalInPage(cdp, "document.querySelector('.mobile-mailbox-footer button')?.click()");
    await waitForExpression(cdp, "document.querySelector('.composer') && !document.querySelector('.mobile-mailbox-sheet')");
    await waitForExpression(cdp, "document.querySelector('.composer .composer-contact-toggle[aria-label=\"切换联系人面板\"][aria-pressed=\"false\"]')");
    await evalInPage(cdp, "document.querySelector('.composer .composer-contact-toggle')?.click()");
    await waitForExpression(cdp, "(() => { const panel = document.querySelector('.composer-contacts-panel'); return panel && getComputedStyle(panel).display !== 'none'; })()");
    await evalInPage(cdp, "document.querySelector('.composer-contacts-panel .composer-contacts-close')?.click()");
    await waitForExpression(cdp, "!document.querySelector('.composer-contacts-panel')");
    await closeComposer(cdp);
    await evalInPage(cdp, "document.querySelector('.mobile-message-list-panel .message-card-main')?.click()");
    await waitForExpression(cdp, "document.querySelector('.mobile-reader-surface > .reader-panel')");
    await waitForExpression(cdp, "(() => { const panel = document.querySelector('.mobile-reader-surface > .reader-panel'); return panel && getComputedStyle(panel).overflowY === 'auto' && getComputedStyle(panel).touchAction === 'pan-y'; })()");
    await evalInPage(cdp, "document.querySelector('[data-narrow-reader-back]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.mobile-message-list-panel') && !document.querySelector('.mobile-reader-surface')");
    await clickButton(cdp, '设置', "document.querySelector('.mobile-bottom-nav')");
    await waitForExpression(cdp, "document.querySelector('.mobile-settings-root') && window.history.state?.betterEmailScreen === 'settings' && !document.querySelector('.settings-modal')");
    await waitForExpression(cdp, "(() => { const scroll = document.querySelector('.mobile-settings-scroll'); return scroll && getComputedStyle(scroll).overflowY === 'auto'; })()");
    await evalInPage(cdp, "[...document.querySelectorAll('.mobile-settings-row')].find((item) => item.textContent.includes('联系人'))?.click()");
    await waitForExpression(cdp, "document.querySelector('.settings-modal[data-ui=\"settings-v2\"]') && document.querySelector('.settings-page[data-settings-page=\"contacts\"]') && window.history.state?.betterEmailSettingsSection === 'contacts'");
    await evalInPage(cdp, "document.querySelector('.settings-close-button[aria-label=\"关闭设置\"]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.mobile-settings-root') && !document.querySelector('.settings-modal') && window.history.state?.betterEmailScreen === 'settings' && !window.history.state?.betterEmailSettingsSection");
    await evalInPage(cdp, "document.querySelector('.mobile-settings-header .mobile-header-icon[aria-label=\"返回邮箱\"]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.mobile-message-list-panel') && window.history.state?.betterEmailScreen === 'mail'");
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, "window.innerWidth === 1440 && !document.querySelector('.app-shell.is-mobile-app')");
    await clickButton(cdp, '加载更多', "document.querySelector('.message-list-footer')");
    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length < 50 && document.body.innerText.includes('已显示 50 封') && document.body.innerText.includes('已到底')");
    await waitForExpression(cdp, "document.body.innerText.includes('远程图片默认阻止')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.reader-warning-panel button')].some((item) => item.textContent.includes('显示图片')) && [...document.querySelectorAll('.reader-warning-panel button')].some((item) => item.textContent.includes('信任发件人')) && [...document.querySelectorAll('.reader-warning-panel button')].some((item) => item.textContent.includes('查看链接')) && document.body.innerText.includes('网页链接已隐藏，查看后可确认目标地址。')");
    await clickButton(cdp, '查看链接', "document.querySelector('.reader-warning-panel')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.reader-warning-panel button')].some((item) => item.textContent.includes('隐藏链接'))");
    const checks = [true, true, true];
    const initialLayout = await evalInPage(
      cdp,
      `(() => {
        const shell = document.querySelector('.app-shell');
        if (!shell) throw new Error('Initial app layout was not rendered');
        const style = getComputedStyle(shell);
        const sidebar = Number.parseFloat(style.getPropertyValue('--app-sidebar-width'));
        const list = Number.parseFloat(style.getPropertyValue('--app-list-width'));
        if (!Number.isFinite(sidebar) || !Number.isFinite(list)) {
          throw new Error('Initial app layout widths were not resolved');
        }
        return { sidebar, list };
      })()`,
    );
    const expectedSidebar = Math.min(320, Math.max(228, initialLayout.sidebar + 34));
    const expectedList = Math.min(500, Math.max(340, initialLayout.list - 44));

    await dragElement(cdp, '.sidebar-resizer', 34);
    await waitForExpression(cdp, `getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--app-sidebar-width').trim() === '${expectedSidebar}px'`);
    await waitForExpression(cdp, `JSON.parse(localStorage.getItem('better-email.appLayout.v2')).sidebar === ${expectedSidebar}`);
    await dragElement(cdp, '.list-resizer', -44);
    await waitForExpression(cdp, `getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--app-list-width').trim() === '${expectedList}px'`);
    await waitForExpression(cdp, `JSON.parse(localStorage.getItem('better-email.appLayout.v2')).list === ${expectedList}`);
    // 布局拖拽结果在页面重载后仍被应用并持久化（不再依赖已删除的重置布局控件）。
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForExpression(
      cdp,
      `JSON.parse(localStorage.getItem('better-email.appLayout.v2')).sidebar === ${expectedSidebar} && JSON.parse(localStorage.getItem('better-email.appLayout.v2')).list === ${expectedList}`,
    );
    await waitForExpression(
      cdp,
      `(() => { const style = getComputedStyle(document.querySelector('.app-shell')); return style.getPropertyValue('--app-sidebar-width').trim() === '${expectedSidebar}px' && style.getPropertyValue('--app-list-width').trim() === '${expectedList}px'; })()`,
    );
    await waitForExpression(cdp, "(() => { const mark = document.querySelector('.brand-mark'); return mark && (mark.tagName === 'IMG' ? (mark.getAttribute('alt') !== null && mark.complete) : (mark.textContent ?? '').trim().length > 0); })()");
    await waitForExpression(cdp, "document.querySelector('.account-switcher-trigger') && !document.querySelector('.account-switcher select')");
    await waitForExpression(cdp, "(() => { const sidebar = document.querySelector('.sidebar')?.getBoundingClientRect(); const list = document.querySelector('.primary-folder-list')?.getBoundingClientRect(); return sidebar && list && list.left >= sidebar.left && list.right <= sidebar.right + 1; })()");
    await openFolderContextMenu(cdp, 'spam', '固定到常用邮箱');
    await clickButton(cdp, '固定到常用邮箱', "document.querySelector('.context-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已固定到常用邮箱：垃圾邮件') && document.querySelector('.primary-folder-list .folder[data-folder-role=\"spam\"][data-favorite=\"true\"]') && JSON.parse(localStorage.getItem('better-email.favoriteFolderKeys.v1')).includes('virtual:spam')");
    const favoriteReloadOrigin = await evalInPage(cdp, 'performance.timeOrigin');
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForExpression(cdp, `performance.timeOrigin !== ${favoriteReloadOrigin} && document.querySelector('.app-shell') && document.querySelector('.primary-folder-list .folder[data-folder-role=\"spam\"][data-favorite=\"true\"]')`);
    await waitForExpression(cdp, "document.querySelector('.primary-folder-list .folder[data-folder-role=\"spam\"]')");
    await openFolderContextMenu(cdp, 'spam', '从常用邮箱移除');
    await clickFolderContextMenuItem(cdp, 'spam', '从常用邮箱移除');
    await waitForExpression(cdp, "document.body.innerText.includes('已从常用邮箱移除：垃圾邮件') && document.querySelector('.primary-folder-list .folder[data-folder-role=\"spam\"]') && !JSON.parse(localStorage.getItem('better-email.favoriteFolderKeys.v1')).includes('virtual:spam')");

    await evalInPage(
      cdp,
      "(() => { const folder = [...document.querySelectorAll('.folder')].find((item) => item.getAttribute('data-folder-role') === 'inbox'); if (!folder) throw new Error('Inbox folder target not found'); const main = folder.querySelector('.folder-main') ?? folder; main.click(); })()",
    );
    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length > 0");
    await evalInPage(
      cdp,
      `(async () => {
        const deadline = Date.now() + 5000;
        let last = null;
        while (Date.now() < deadline) {
          const badge = Number(document.querySelector('.folder[data-folder-role="inbox"] .badge')?.textContent || 0);
          if (last !== null && badge === last) return;
          last = badge;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      })()`,
    );
    await evalInPage(
      cdp,
      `(async () => {
        const folder = [...document.querySelectorAll('.folder')].find((item) => item.getAttribute('data-folder-role') === 'inbox');
        if (!folder) throw new Error('Inbox folder target not found');
        const badge = folder.querySelector('.badge');
        if (badge && Number(badge.textContent) > 0) return;
        const card = document.querySelector('.message-card');
        if (!card) throw new Error('Inbox unread setup target not found');
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 320, button: 2 }));
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const menu = document.querySelector('.context-menu');
          const button = menu && [...menu.querySelectorAll('button')].find((item) => item.textContent.includes('标为未读'));
          if (button) { button.click(); return; }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Inbox unread setup target not found: mark-unread context action did not appear');
      })()`,
    );
    await waitForExpression(cdp, "Number(document.querySelector('.folder[data-folder-role=\"inbox\"] .badge')?.textContent || 0) > 0 && document.querySelector('.message-card.is-unread')");
    await evalInPage(
      cdp,
      "(() => { const card = document.querySelector('.message-card.is-unread'); if (!card) throw new Error('Unread auto-read target not found'); window.__autoReadMessageId = card.dataset.messageId; window.__autoReadCardCountBefore = document.querySelectorAll('.message-card').length; const target = card.querySelector('.message-card-main') ?? card; target.click(); })()",
    );
    await waitForExpression(
      cdp,
      "(() => { const messageId = String(window.__autoReadMessageId || ''); const card = [...document.querySelectorAll('.message-card')].find((item) => item.dataset.messageId === messageId); return card && document.querySelectorAll('.message-card').length === window.__autoReadCardCountBefore && card.classList.contains('is-read') && !card.querySelector('.message-unread-dot'); })()",
      10_000,
    );
    await evalInPage(
      cdp,
      `(async () => {
        const messageId = String(window.__autoReadMessageId || '');
        const card = [...document.querySelectorAll('.message-card')].find((item) => item.dataset.messageId === messageId);
        if (!card) throw new Error('Auto-read card not found for mark-unread');
        card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 320, button: 2 }));
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const menu = document.querySelector('.context-menu');
          const button = menu && [...menu.querySelectorAll('button')].find((item) => item.textContent.includes('标为未读'));
          if (button) { button.click(); return; }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Mark unread button not found');
      })()`,
    );
    await waitForExpression(cdp, "Number(document.querySelector('.primary-folder-list .folder[data-folder-role=\"inbox\"] .badge')?.textContent || 0) > 0");
    await evalInPage(cdp, "(() => { if (document.querySelectorAll('.global-search-box input').length !== 1 || document.querySelector('.message-list-panel .search-box')) throw new Error('Global search must render exactly once in the titlebar'); })()");
    await openDetails(cdp, '.filter-menu');
    await clickButton(cdp, '未读', "document.querySelector('.filter-menu')");
    await waitForExpression(cdp, "document.querySelector('.filter-menu summary')?.textContent.includes('未读') && document.querySelector('.message-card.is-unread')");
    await openDetails(cdp, '.sort-menu');
    await clickButton(cdp, '最早优先', "document.querySelector('.sort-menu')");
    await waitForExpression(cdp, "document.querySelector('.sort-menu summary')?.textContent.includes('时间') && document.querySelector('.sort-menu [aria-checked=\"true\"]')?.textContent.includes('最早优先')");
    await evalInPage(
      cdp,
      "(() => { const folder = document.querySelector('.primary-folder-list .folder[data-folder-role=\"inbox\"]'); const badge = folder?.querySelector('.badge'); if (!folder || !badge || Number(badge.textContent) <= 0) throw new Error('Inbox unread folder target not found'); window.__folderUnreadBefore = Number(badge.textContent); folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 180, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')?.innerText.includes('全部标为已读')");
    await clickButton(cdp, '全部标为已读', "document.querySelector('.context-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes(`已将 ${window.__folderUnreadBefore} 封邮件标为已读`) && !document.querySelector('.primary-folder-list .folder[data-folder-role=\"inbox\"] .badge')");
    await openDetails(cdp, '.filter-menu');
    await clickButton(cdp, '全部', "document.querySelector('.filter-menu')");
    await waitForExpression(cdp, "document.querySelector('.filter-menu summary')?.textContent.includes('全部') && !document.querySelector('.view-menu') && document.body.innerText.includes('已显示')");
    await openDetails(cdp, '.sort-menu');
    await clickButton(cdp, '最新优先', "document.querySelector('.sort-menu')");
    await waitForExpression(cdp, "document.querySelector('.sort-menu summary')?.textContent.includes('时间') && document.querySelector('.sort-menu [aria-checked=\"true\"]')?.textContent.includes('最新优先')");
    await evalInPage(
      cdp,
      "(() => { const folder = document.querySelector('.primary-folder-list .folder[data-folder-role=\"trash\"]'); if (!folder) throw new Error('Trash folder context target not found'); folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 380, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')?.innerText.includes('清空废纸篓')");
    await clickButton(cdp, '清空废纸篓', "document.querySelector('.context-menu')");
    await waitForExpression(cdp, "document.querySelector('.dialog-card') && document.querySelector('.dialog-card')?.innerText.includes('此操作不可逆')");
    await clickButton(cdp, '确认', "document.querySelector('.dialog-card')");
    await waitForExpression(cdp, "document.body.innerText.includes('已清空废纸篓：本地永久删除 1 封') && document.body.innerText.includes('远端成功 1 封')");

    await clickButton(cdp, '快捷键');
    await waitForExpression(cdp, "document.querySelector('.shortcut-modal') && document.body.innerText.includes('高频邮件操作') && document.body.innerText.includes('快速搜索') && document.body.innerText.includes('选择当前列表全部邮件') && document.body.innerText.includes('撤销上一步邮件操作')");
    await clickButton(cdp, '关闭', "document.querySelector('.shortcut-modal')");
    await waitForExpression(cdp, "!document.querySelector('.shortcut-modal')");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }))");
    await waitForExpression(cdp, "document.querySelector('.shortcut-modal') && document.body.innerText.includes('回复全部') && document.body.innerText.includes('移到废纸篓')");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitForExpression(cdp, "!document.querySelector('.shortcut-modal')");
    await clickButton(cdp, '会话', "document.querySelector('.list-control-actions')");
    await waitForExpression(cdp, "document.querySelector('.thread-list') && document.querySelectorAll('.thread-card').length >= 1");
    await clickButton(cdp, '邮件', "document.querySelector('.list-control-actions')");
    await waitForExpression(cdp, "document.querySelector('.message-list') && document.querySelectorAll('.message-card').length >= 1");

    await fillInput(cdp, '.search-box input', 'Quarterly');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "document.body.innerText.includes('Quarterly update')");

    await fillInput(cdp, '.search-box input', 'filename:security-checklist.pdf');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await evalInPage(cdp, "document.querySelector('.search-clear-button').click()");
    await waitForExpression(cdp, "document.querySelector('.search-box input').value === '' && document.querySelectorAll('.message-card').length >= 2 && document.body.innerText.includes('已清空搜索和筛选')");
    await fillInput(cdp, '.search-box input', 'Current account archive search sample');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "![...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('Current account archive search sample'))");
    await openDetails(cdp, '.search-scope-menu');
    await waitForExpression(cdp, "document.querySelector('.search-scope-menu[open]') && document.querySelector('.search-scope-menu').innerText.includes('当前文件夹') && document.querySelector('.search-scope-menu').innerText.includes('当前账号') && document.querySelector('.search-scope-menu').innerText.includes('全部账号')");
    await clickButton(cdp, '当前账号', "document.querySelector('.search-scope-menu')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('Current account archive search sample')) && document.querySelector('.search-scope-menu summary')?.textContent.includes('账号')");
    await openDetails(cdp, '.search-scope-menu');
    await clickButton(cdp, '全部账号', "document.querySelector('.search-scope-menu')");
    await fillInput(cdp, '.search-box input', 'Global account search sample');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "[...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('Global account search sample')) && document.querySelector('.search-scope-menu summary')?.textContent.includes('全部')");
    await evalInPage(cdp, "document.querySelector('.search-clear-button').click()");
    await waitForExpression(cdp, "document.querySelector('.search-box input').value === '' && document.querySelector('.search-scope-menu summary')?.textContent.includes('文件夹')");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('安全检查清单')).click()");
    await waitForExpression(cdp, "document.querySelector('.reader-actions button[aria-label=\"取消星标\"]')");
    await evalInPage(cdp, "document.querySelector('.reader-actions button[aria-label=\"取消星标\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.innerText.includes('远端 \\\\Flagged 状态已同步')");
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
    await waitForExpression(cdp, "!document.querySelector('.contact-center') && !document.body.innerText.includes('搜索联系人')");
    await clickButton(cdp, '设置', "document.querySelector('.sidebar-footer')");
    await waitForExpression(cdp, "document.querySelector('.settings-modal') && document.querySelector('.settings-nav')");
    await openSettingsSection(cdp, '联系人', 'contacts', '.settings-page[data-settings-page="contacts"]');
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"contacts\"]')?.innerText.includes('还没有联系人')");
    await openContactCreateDialog(cdp);
    await fillInput(cdp, '.contact-create-form input[placeholder="联系人名称"]', 'Ada');
    await fillInput(cdp, '.contact-create-form input[placeholder="name@example.com"]', 'ada@example.com');
    await clickButton(cdp, '确认添加', "document.querySelector('.contact-create-form')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('联系人已新增：Ada') && [...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('ada@example.com'))");
    await openContactCreateDialog(cdp);
    await fillInput(cdp, '.contact-create-form input[placeholder="联系人名称"]', 'Security Team');
    await fillInput(cdp, '.contact-create-form input[placeholder="name@example.com"]', 'security@example.com');
    await clickButton(cdp, '确认添加', "document.querySelector('.contact-create-form')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('联系人已新增：Security Team') && [...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('security@example.com'))");
    await clickButton(cdp, '编辑', "[...document.querySelectorAll('.contact-tool-row')].find((row) => row.innerText.includes('security@example.com'))");
    await waitForExpression(cdp, "document.querySelector('.settings-modal') && document.querySelector('.contact-edit-form')");
    await clickButton(cdp, '取消', "document.querySelector('.contact-edit-form')");
    await waitForExpression(cdp, "!document.querySelector('.contact-edit-form')");
    await evalInPage(cdp, "(() => { const button = document.querySelector('.settings-modal header button[aria-label=\"关闭设置\"]') ?? [...document.querySelectorAll('.settings-modal header button')].find((item) => item.textContent.includes('关闭')); if (!button) throw new Error('Settings close button not found'); button.click(); })()");
    await waitForExpression(cdp, "!document.querySelector('.settings-modal')");
    await fillInput(cdp, '.search-box input', '');
    await evalInPage(cdp, "document.querySelector('.search-box').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));");
    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length >= 2");

    await clickButton(cdp, '写邮件');
    await waitForExpression(cdp, "document.querySelector('.composer input[role=\"combobox\"]')");
    await fillInput(cdp, '.composer input[role="combobox"]', 'ada@example.com');
    await waitForExpression(cdp, "document.querySelector('.composer input[role=\"combobox\"]').value.includes('ada@example.com')");
    await clickButton(cdp, '写邮件');
    await waitForExpression(cdp, "document.querySelectorAll('.composer').length === 1 && document.querySelector('.composer input[role=\"combobox\"]').value.includes('ada@example.com') && document.activeElement?.closest('.composer')");
    await closeComposer(cdp);

    await clickButton(cdp, '写邮件');
    await waitForExpression(cdp, "document.body.innerText.includes('新邮件') && (document.querySelector('.composer textarea') || document.querySelector('.composer-richtext-body'))");
    const recipientHoverBaseline = await evalInPage(cdp, `(() => {
      const rows = [...document.querySelectorAll('.composer .composer-recipient-field .composer-field-row')];
      return rows.map((row) => {
        const input = row.querySelector('input');
        const rect = row.getBoundingClientRect();
        const inputRect = input?.getBoundingClientRect();
        return {
          label: row.querySelector('span')?.textContent?.trim(),
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          height: rect.height,
          inputHeight: inputRect?.height,
        };
      });
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });
    for (const row of recipientHoverBaseline ?? []) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: row.x, y: row.y });
      await sleep(40);
      const hovered = await evalInPage(cdp, `(() => {
        const row = [...document.querySelectorAll('.composer .composer-recipient-field .composer-field-row')]
          .find((item) => item.querySelector('span')?.textContent?.trim() === ${JSON.stringify(row.label)});
        if (!row) return null;
        const input = row.querySelector('input');
        const rect = row.getBoundingClientRect();
        const inputRect = input?.getBoundingClientRect();
        return {
          height: rect.height,
          inputHeight: inputRect?.height,
          hovered: row.matches(':hover'),
        };
      })()`);
      if (!hovered?.hovered || hovered.height !== row.height || hovered.inputHeight !== row.inputHeight) {
        throw new Error(`Recipient row geometry changed on hover: ${JSON.stringify({ before: row, after: hovered })}`);
      }
    }
    await evalInPage(cdp, `(() => {
      const button = document.querySelector('.composer header button[aria-label="收起写信"]');
      if (!button) throw new Error('Composer minimize button not found');
      button.click();
    })()`);
    await waitForExpression(cdp, "document.querySelector('.composer-minimized') && document.body.innerText.includes('展开')");
    await evalInPage(cdp, `(() => {
      const button = document.querySelector('.composer-minimized button[aria-label="展开写信窗口"]');
      if (!button) throw new Error('Composer restore button not found');
      button.click();
    })()`);
    await waitForExpression(cdp, "document.querySelector('.composer textarea') || document.querySelector('.composer-richtext-body')");
    await waitForExpression(cdp, "!document.querySelector('.composer-advanced') && !document.querySelector('.composer-advanced-popover')");
    await evalInPage(cdp, "document.querySelector('.composer input[role=\"combobox\"]').focus()");
    await fillInput(cdp, '.composer input[role="combobox"]', 'ada');
    await waitForExpression(cdp, "!document.querySelector('datalist') && [...document.querySelectorAll('.recipient-suggestions button')].some((item) => item.textContent.includes('ada@example.com')) && document.body.innerText.includes('匹配联系人')");
    await clickButton(cdp, 'Ada', "document.querySelector('.recipient-suggestions')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.composer-recipient-chip-copy')].some((item) => item.getAttribute('title') === 'ada@example.com')");
    await fillInput(cdp, '.composer input[aria-label=\"主题\"]', 'Smoke Draft Flow');
    await fillComposerBody(cdp, '保存草稿路径验证');
    await waitForExpression(cdp, "JSON.parse(localStorage.getItem('better-email.composerAutosave')).draft.subject === 'Smoke Draft Flow' && (JSON.parse(localStorage.getItem('better-email.composerAutosave')).draft.body ?? '').includes('保存草稿路径验证') && document.body.innerText.includes('已自动保存')");
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitForExpression(cdp, "document.querySelector('.app-shell') && document.body.innerText.includes('Better Email')");
    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length >= 2");
    await clickButton(cdp, '设置', "document.querySelector('.sidebar-footer')");
    await waitForExpression(cdp, "document.querySelector('.settings-modal')");
    await openSettingsSection(cdp, '联系人', 'contacts', '.settings-page[data-settings-page=\"contacts\"]');
    const contactsNeedComposeSeed = await evalInPage(cdp, "![...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('ada@example.com'))");
    if (contactsNeedComposeSeed) {
      await openContactCreateDialog(cdp);
      await fillInput(cdp, '.contact-create-form input[placeholder=\"联系人名称\"]', 'Ada');
      await fillInput(cdp, '.contact-create-form input[placeholder=\"name@example.com\"]', 'ada@example.com');
      await clickButton(cdp, '确认添加', "document.querySelector('.contact-create-form')");
      await waitForExpression(cdp, "[...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('ada@example.com'))");
      await openContactCreateDialog(cdp);
      await fillInput(cdp, '.contact-create-form input[placeholder=\"联系人名称\"]', 'Security Team');
      await fillInput(cdp, '.contact-create-form input[placeholder=\"name@example.com\"]', 'security@example.com');
      await clickButton(cdp, '确认添加', "document.querySelector('.contact-create-form')");
      await waitForExpression(cdp, "[...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('security@example.com'))");
    }
    await evalInPage(cdp, "document.querySelector('.settings-modal header button[aria-label=\"关闭设置\"]')?.click()");
    await waitForExpression(cdp, "!document.querySelector('.settings-modal')");
    await clickButton(cdp, '写邮件');
    await waitForExpression(cdp, "document.querySelector('.composer input[aria-label=\"主题\"]').value === 'Smoke Draft Flow' && document.body.innerText.includes('已从恢复点还原邮件')");
    await waitForExpression(cdp, "(() => { const rich = document.querySelector('.composer-richtext-body'); if (rich) return (rich.textContent ?? '').includes('保存草稿路径验证'); const plain = document.querySelector('.composer textarea[placeholder=\"正文\"]'); return Boolean(plain && (plain.value ?? '').includes('保存草稿路径验证')); })()");
    await waitForExpression(cdp, "document.querySelector('.composer.has-contacts-panel .composer-contacts-panel') && document.querySelector('.composer-contacts-search input')");
    await waitForExpression(cdp, "!document.querySelector('.composer .composer-contact-toggle') && !document.querySelector('.composer-contacts-panel .composer-contacts-close') && document.querySelector('.composer-contacts-tabs [role=\"tab\"][aria-selected=\"true\"]')");
    const composeGeometry = await evalInPage(cdp, `(() => {
      const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect() ?? null;
      const editor = rect('.composer-editor-pane');
      const contacts = rect('.composer-contacts-panel');
      const sender = rect('.composer-sender-context');
      const recipient = rect('.composer-recipient-field .composer-field-row');
      const subject = rect('.composer-subject-field');
      const toolbar = rect('.composer-rich-toolbar');
      const body = rect('.composer-body-field');
      const footer = rect('.composer footer');
      const send = rect('.composer-send-split');
      const contactsFooter = rect('.composer-contacts-footer');
      const rows = [...document.querySelectorAll('.composer-contact-row')];
      const list = rect('.composer-contacts-list');
      const lastRow = rows.at(-1)?.getBoundingClientRect() ?? null;
      const within = (value, min, max) => value != null && value >= min && value <= max;
      return {
        rightPanelWidth: contacts?.width,
        senderHeight: sender?.height,
        recipientHeight: recipient?.height,
        subjectHeight: subject?.height,
        toolbarHeight: toolbar?.height,
        bodyHeight: body?.height,
        footerHeight: footer?.height,
        contactsRowHeight: rows[0]?.getBoundingClientRect().height,
        contactsFooterHeight: contactsFooter?.height ?? 0,
        sendWidth: send?.width,
        noHorizontalScroll: document.documentElement.scrollWidth <= innerWidth,
        panesDoNotOverlap: Boolean(editor && contacts && editor.right <= contacts.left),
        noContactSelectionUI: !document.querySelector('.composer-contacts-footer, .composer-contact-select, .composer-contact-batch, .composer-contact-target-menu'),
        hasContactRows: Boolean(rows.length && list && lastRow),
        hasContactEmptyState: Boolean(document.querySelector('.composer-contacts-empty')),
        oneBottomOperationRow: document.querySelectorAll('.composer footer').length === 1
          && document.querySelectorAll('.composer footer .composer-quick-tools').length === 1
          && document.querySelectorAll('.composer > .composer-quick-tools').length === 0,
        noStandaloneScheduleStatus: !document.querySelector('.composer-schedule-status'),
        oneWindowControlSet: document.querySelectorAll('.composer header button[aria-label="收起写信"]').length === 1
          && document.querySelectorAll('.composer header button[aria-label="关闭写信窗口"]').length === 1
          && document.querySelectorAll('.composer-contacts-panel [aria-label="收起写信"]').length === 0
          && document.querySelectorAll('.composer-contacts-panel [aria-label="关闭写信窗口"]').length === 0
          && document.querySelectorAll('.composer-contacts-panel [aria-label="关闭联系人面板"]').length === 0
          && document.querySelectorAll('.composer .composer-contact-toggle').length === 0,
        ranges: Boolean(
          within(contacts?.width, ${COMPOSE_CONTACTS_WIDTH - 4}, ${COMPOSE_CONTACTS_WIDTH + 4})
          && within(sender?.height, 0, 60)
          && within(recipient?.height, 0, 68)
          && within(subject?.height, 0, 60)
          && within(toolbar?.height, 0, 50)
          && (body?.height ?? 0) >= 220
          && (!rows.length || (rows[0].getBoundingClientRect().height <= 70))
          && (contactsFooter?.height ?? 0) <= 68
          && (send?.width ?? 999) <= 220,
        ),
      };
    })()`);
    if (!composeGeometry?.ranges || !composeGeometry.noHorizontalScroll || !composeGeometry.panesDoNotOverlap || !composeGeometry.noContactSelectionUI || !composeGeometry.oneBottomOperationRow || !composeGeometry.noStandaloneScheduleStatus || !composeGeometry.oneWindowControlSet || (!composeGeometry.hasContactRows && !composeGeometry.hasContactEmptyState)) {
      throw new Error(`Compose geometry contract failed: ${JSON.stringify(composeGeometry)}`);
    }
    if (composeGeometry.hasContactRows) {
      await evalInPage(cdp, "(() => { const list = document.querySelector('.composer-contacts-list'); if (list) list.scrollTop = list.scrollHeight; return true; })()");
      await waitForExpression(cdp, "(() => { const list = document.querySelector('.composer-contacts-list')?.getBoundingClientRect(); const rows = [...document.querySelectorAll('.composer-contact-row')]; const last = rows.at(-1)?.getBoundingClientRect(); return Boolean(list && last && last.bottom <= list.bottom + 1); })()");
    }
    for (const [width, height, name] of [
      [1536, 1024, 'compose-final-polish-1536'],
      [1440, 900, 'compose-final-polish-1440'],
      [1280, 800, 'compose-final-polish-1280'],
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitForExpression(cdp, `window.innerWidth === ${width} && document.querySelector('.composer-editor-pane')`);
      await sleep(120);
      await captureScreenshot(cdp, name);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 1440 && document.querySelector(\'.composer-editor-pane\')');
    await waitForExpression(cdp, "document.querySelector('.composer-contacts-panel') && !document.querySelector('.composer .composer-contact-toggle') && !document.querySelector('.composer-contacts-panel .composer-contacts-close')");
    await fillInput(cdp, '.composer-contacts-search input', 'nobody@example.com');
    await waitForExpression(cdp, "document.querySelector('.composer-contacts-empty')?.innerText.includes('没有找到匹配联系人')");
    await evalInPage(cdp, "document.querySelector('.composer-contacts-search button[aria-label=\"清除联系人搜索\"]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.composer-contacts-search input')?.value === ''");
    await clickButton(cdp, '抄送', "document.querySelector('.composer-recipient-field')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.composer-recipient-field .composer-field-row')].some((row) => row.querySelector('span')?.textContent?.trim() === '抄送')");
    await evalInPage(cdp, "(() => { const row = [...document.querySelectorAll('.composer-recipient-field .composer-field-row')].find((item) => item.querySelector('span')?.textContent?.trim() === '抄送'); row?.querySelector('input')?.focus(); })()");
    await waitForExpression(cdp, "document.querySelector('.composer-contact-add:not(.is-added)')?.getAttribute('aria-label')?.includes('到抄送')");
    await captureScreenshot(cdp, 'compose-final-polish-cc-target');
    await evalInPage(cdp, "document.querySelector('.composer-send-menu-trigger')?.click()");
    await waitForExpression(cdp, "document.querySelector('.composer-send-menu')");
    await clickButton(cdp, '定时发送…', "document.querySelector('.composer-send-menu')");
    await waitForExpression(cdp, "document.querySelector('.composer-schedule-picker-popover') && !document.querySelector('.composer input[type=\"datetime-local\"]')");
    await captureScreenshot(cdp, 'compose-final-polish-schedule-open');
    await clickButton(cdp, '今天', "document.querySelector('.composer-schedule-picker-popover')");
    await waitForExpression(cdp, "document.querySelector('.composer-schedule-picker-popover') && !document.querySelector('.composer-schedule-status')");
    await evalInPage(cdp, `(() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const label = String(tomorrow.getFullYear()) + '年' + String(tomorrow.getMonth() + 1) + '月' + String(tomorrow.getDate()) + '日';
      const cell = [...document.querySelectorAll('.composer-schedule-picker-popover [role="gridcell"]')]
        .find((item) => item.getAttribute('aria-label') === label);
      if (!cell) throw new Error('Tomorrow schedule cell not found: ' + label);
      cell.click();
    })()`);
    await clickButton(cdp, '确定', "document.querySelector('.composer-schedule-picker-popover')");
    await waitForExpression(cdp, "document.querySelector('.composer-schedule-status') && document.querySelector('.composer-schedule-picker-trigger.is-set') && !document.querySelector('.composer-schedule-picker-popover')");
    await evalInPage(cdp, "document.querySelector('.composer-schedule-clear')?.click()");
    await waitForExpression(cdp, "document.querySelector('.composer-schedule-clear-confirm')");
    await clickButton(cdp, '确认取消', "document.querySelector('.composer-schedule-clear-confirm')");
    await waitForExpression(cdp, "!document.querySelector('.composer-schedule-status') && !document.querySelector('.composer-schedule-picker-trigger.is-set')");
    await clickButton(cdp, '插入模板', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.querySelector('.composer-templates-popover')");
    await captureScreenshot(cdp, 'compose-final-polish-template-popover');
    await clickButton(cdp, '保存为模板…', "document.querySelector('.composer-templates-popover')");
    await waitForExpression(cdp, "document.querySelector('.composer-template-save-dialog')");
    await fillInput(cdp, '.composer-template-save-dialog input[aria-label=\"模板名称\"]', 'Smoke 模板');
    await clickButton(cdp, '保存', "document.querySelector('.composer-template-save-dialog')");
    await waitForExpression(cdp, "document.body.innerText.includes('模板已保存：Smoke 模板')");
    await fillInput(cdp, '.composer input[aria-label=\"主题\"]', 'Smoke Template Mutated');
    await fillComposerBody(cdp, '模板覆盖前正文');
    await evalInPage(cdp, "(() => { const subject = document.querySelector('.composer input[aria-label=\"主题\"]'); subject?.focus(); return true; })()");
    await clickButton(cdp, '插入模板', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.querySelector('.composer-template-list')");
    await clickButton(cdp, 'Smoke 模板', "document.querySelector('.composer-template-list')");
    await waitForExpression(cdp, "document.querySelector('.composer input[aria-label=\"主题\"]').value === 'Smoke Template Mutated' && document.body.innerText.includes('已插入模板：Smoke 模板') && document.body.innerText.includes('主题已保留')");
    await waitForExpression(cdp, "(() => { const rich = document.querySelector('.composer-richtext-body'); if (rich) return (rich.textContent ?? '').includes('模板覆盖前正文'); const plain = document.querySelector('.composer textarea[placeholder=\\\"正文\\\"]'); return Boolean(plain && (plain.value ?? '').includes('模板覆盖前正文')); })()");
    await waitForExpression(cdp, "(() => { const rich = document.querySelector('.composer-richtext-body'); if (rich) return (rich.textContent ?? '').includes('保存草稿路径验证'); const plain = document.querySelector('.composer textarea[placeholder=\\\"正文\\\"]'); return Boolean(plain && (plain.value ?? '').includes('保存草稿路径验证')); })()");
    await clickButton(cdp, '更多写信工具', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.querySelector('.composer-more-popover') && !document.querySelector('.composer-more-popover .composer-template-list')");
    await captureScreenshot(cdp, 'compose-final-polish-more-menu');
    await evalInPage(cdp, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitForExpression(cdp, "!document.querySelector('.composer-more-popover')");
    await evalInPage(cdp, `(() => {
      const editor = document.querySelector('.composer-richtext-body');
      if (!editor) return false;
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (!node) return false;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    })()`);
    await evalInPage(cdp, "document.querySelector('.composer-rich-toolbar button[aria-label=\"插入链接\"]')?.click()");
    await waitForExpression(cdp, "document.querySelector('.composer-link-popover')");
    await captureScreenshot(cdp, 'compose-final-polish-link-popover');
    await fillInput(cdp, '.composer-link-popover input', 'https://example.com', 0);
    await clickButton(cdp, '插入', "document.querySelector('.composer-link-popover')");
    await waitForExpression(cdp, "document.querySelector('.composer-richtext-body a[href=\"https://example.com\"]')");
    await evalInPage(cdp, `(() => {
      const editor = document.querySelector('.composer-richtext-body');
      if (!editor) return false;
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector('.composer-rich-toolbar button[aria-label="加粗"]')?.click();
      return true;
    })()`);
    await waitForExpression(cdp, "document.querySelector('.composer-rich-toolbar button[aria-label=\"加粗\"]')?.getAttribute('aria-pressed') === 'true'");
    await captureScreenshot(cdp, 'compose-final-polish-toolbar-active');
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
    await clickButton(cdp, '附件', "document.querySelector('.composer-attachments')");
    await waitForExpression(cdp, "document.body.innerText.includes('smoke-brief.txt') && document.body.innerText.includes('已添加附件 1 个') && document.querySelectorAll('.composer .composer-attachment-tile').length === 2");
    await pickCustomSelect(cdp, '.composer .custom-select-summary[aria-label="发件人"]', 'Demo Support');
    await waitForExpression(cdp, "[...document.querySelectorAll('.composer .composer-footer-tool-group button')].some((button) => button.textContent.includes('签名') && !button.disabled)");
    await clickButton(cdp, '签名', "document.querySelector('.composer .composer-footer-tool-group')");
    await waitForExpression(cdp, "(() => { const rich = document.querySelector('.composer-richtext-body'); if (rich) return (rich.textContent ?? '').includes('Better Email Support'); const plain = document.querySelector('.composer textarea[placeholder=\\\"正文\\\"]'); return Boolean(plain && (plain.value ?? '').includes('Better Email Support')); })()");
    await clickButton(cdp, '更多写信工具', "document.querySelector('.composer')");
    await waitForExpression(cdp, "document.querySelector('.composer-more-popover')");
    await clickButton(cdp, '保存草稿', "document.querySelector('.composer-more-popover')");
    await waitForExpression(cdp, "document.body.innerText.includes('同步到远端草稿箱')");
    await closeComposer(cdp);

    await clickButton(cdp, '写邮件');
    await fillInput(cdp, '.composer input[role=\"combobox\"]', 'ada@example.com');
    await fillInput(cdp, '.composer input[aria-label=\"主题\"]', 'Smoke Outbox Flow');
    await fillComposerBody(cdp, '发件箱排队路径验证');
    await evalInPage(cdp, "document.querySelector('.composer-send-menu-trigger')?.click()");
    await waitForExpression(cdp, "document.querySelector('.composer-send-menu[role=\"menu\"]')");
    await clickButton(cdp, '发件箱', "document.querySelector('.composer-send-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('邮件已加入发件箱队列')");
    await closeComposer(cdp);

    await evalInPage(
      cdp,
      "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { window.__copiedText = value; } } })",
    );
    await evalInPage(
      cdp,
      "(() => { const card = [...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Low memory digest')); if (!card) throw new Error('Context menu target message not found'); window.__contextTargetWasUnread = Boolean(card.querySelector('.sender.unread')); card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 320, button: 2 })); })()",
    );
    await waitForExpression(cdp, "(() => { const menu = document.querySelector('.context-menu'); return menu && menu.innerText.includes('回复') && menu.innerText.includes('转发') && menu.innerText.includes('稍后处理') && menu.innerText.includes('移动到') && menu.innerText.includes('标签') && menu.innerText.includes('复制信息') && menu.textContent.includes('发件人邮箱') && menu.textContent.includes('邮件主题'); })()");
    await evalInPage(
      cdp,
      "(() => { const button = document.querySelector('[data-context-item=\"copy-message-info\"]'); if (!button) throw new Error('Copy submenu not found'); button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); })()",
    );
    await waitForExpression(cdp, "(document.activeElement ?? window.__focusedElement)?.getAttribute('data-context-item') === 'copy-sender'");
    await evalInPage(cdp, "document.querySelector('[data-context-item=\"copy-sender\"]').click()");
    await waitForExpression(cdp, "!document.querySelector('.context-menu') && document.querySelector('.status-line')?.innerText.includes('已复制发件人邮箱') && window.__copiedText?.includes('@')");
    await evalInPage(
      cdp,
      "(() => { const card = [...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Low memory digest')); if (!card) throw new Error('Context copy target message not found'); card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 320, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')?.textContent.includes('邮件主题')");
    await evalInPage(
      cdp,
      "(() => { const button = document.querySelector('[data-context-item=\"copy-message-info\"]'); if (!button) throw new Error('Copy submenu not found'); button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); })()",
    );
    await waitForExpression(cdp, "(document.activeElement ?? window.__focusedElement)?.getAttribute('data-context-item') === 'copy-sender'");
    await evalInPage(cdp, "document.querySelector('[data-context-item=\"copy-subject\"]').click()");
    await waitForExpression(cdp, "!document.querySelector('.context-menu') && document.querySelector('.status-line')?.innerText.includes('已复制邮件主题') && window.__copiedText?.includes('Low memory digest')");
    await evalInPage(
      cdp,
      "(() => { const card = [...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Low memory digest')); if (!card) throw new Error('Context read-state target message not found'); card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 320, button: 2 })); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')");
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
    await waitForExpression(cdp, "((document.activeElement ?? window.__focusedElement)?.closest('.context-submenu')) && ((document.activeElement ?? window.__focusedElement)?.textContent?.trim().length > 0)");
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
      "(() => { const footerText = document.querySelector('.message-list-footer')?.textContent || ''; const match = footerText.match(/已显示 (\\d+) 封/); window.__bulkShortcutVisibleCount = match ? Number(match[1]) : 0; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true })); })()",
    );
    await waitForExpression(cdp, "(() => { const status = document.querySelector('.status-line')?.innerText || ''; const match = status.match(/已选择当前列表 (\\d+) 封邮件/); const selected = document.querySelector('.bulk-selection span')?.innerText || ''; return Boolean(match) && selected === `已选 ${match[1]}` && Number(match[1]) >= (window.__bulkShortcutVisibleCount || 0); })()");
    await evalInPage(cdp, "(() => { const match = (document.querySelector('.status-line')?.innerText || '').match(/已选择当前列表 (\\d+) 封邮件/); if (!match) throw new Error('Keyboard select-all count not found'); window.__bulkShortcutCount = Number(match[1]); })()");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "(() => { const status = document.querySelector('.status-line')?.innerText || ''; return !document.querySelector('.bulk-toolbar') && status.includes(`${window.__bulkShortcutCount} 封邮件`) && (status.includes('已批量添加星标') || status.includes('已批量取消星标')); })()");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "document.querySelector('.bulk-selection span')?.innerText === `已选 ${window.__bulkShortcutCount}`");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
    await waitForExpression(cdp, "!document.querySelector('.bulk-toolbar') && document.body.innerText.includes('已取消邮件选择')");

    await clickButton(cdp, '会话', "document.querySelector('.list-control-actions')");
    await waitForExpression(cdp, "document.querySelectorAll('.thread-card').length >= 1 && document.querySelector('.thread-card .thread-count-badge')?.textContent.includes('封')");
    await evalInPage(cdp, "document.querySelector('.thread-card').click()");
    await waitForExpression(cdp, "document.querySelector('.thread-reader') && document.querySelectorAll('.thread-message').length >= 1 && document.querySelector('.thread-message:last-child')?.classList.contains('active')");
    await waitForExpression(cdp, "document.querySelector('.thread-reader .reader-actions [title=\"添加整个会话星标\"], .thread-reader .reader-actions [title=\"取消整个会话星标\"]')");
    await evalInPage(cdp, "document.querySelector('.thread-reader .reader-actions [title=\"添加整个会话星标\"], .thread-reader .reader-actions [title=\"取消整个会话星标\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.innerText.includes('已对会话') && document.querySelector('.status-line')?.innerText.includes('星标')");
    await evalInPage(
      cdp,
      "document.querySelector('.thread-card').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 360, button: 2 }))",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu') && document.querySelector('.context-menu').innerText.includes('会话操作') && document.querySelector('[data-context-item=\"bulk-read-state\"]')");
    await evalInPage(cdp, "document.querySelector('[data-context-item=\"bulk-read-state\"]').click()");
    await waitForExpression(cdp, "!document.querySelector('.context-menu') && document.querySelector('.status-line')?.innerText.includes('已对会话') && document.querySelector('.status-line')?.innerText.includes('标为')");
    await evalInPage(
      cdp,
      "document.querySelector('.thread-card').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 520, clientY: 360, button: 2 }))",
    );
    await waitForExpression(cdp, "document.querySelector('.context-menu')?.innerText.includes('静音会话')");
    await clickButton(cdp, '静音会话', "document.querySelector('.context-menu')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.innerText.includes('已静音会话') && document.querySelector('.thread-card .thread-muted-indicator')?.innerText.includes('静音')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '取消静音会话', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.innerText.includes('已取消静音会话') && !document.querySelector('.thread-card .thread-muted-indicator')");
    await fillInput(cdp, '.search-box input', '安全检查清单');
    await evalInPage(cdp, "document.querySelector('.search-box').requestSubmit()");
    await waitForExpression(cdp, "document.querySelectorAll('.thread-card').length === 1 && [...document.querySelectorAll('.thread-card')].some((item) => item.textContent.includes('安全检查清单'))");
    await evalInPage(cdp, "document.querySelector('.search-clear-button').click()");
    await waitForExpression(cdp, "document.querySelector('.thread-list') && document.querySelectorAll('.thread-card').length >= 1");
    await clickButton(cdp, '邮件', "document.querySelector('.list-control-actions')");
    await waitForExpression(cdp, "document.querySelector('.message-list') && document.querySelectorAll('.message-card').length >= 1");

    await openDetails(cdp, '.sidebar-tools');
    await fillInput(cdp, '.custom-folder-form input[placeholder="新建文件夹"]', '客户跟进');
    await clickButton(cdp, '添加', "document.querySelector('.custom-folder-form')");
    await waitForExpression(cdp, "document.body.innerText.includes('已创建文件夹：客户跟进')");
    await waitForExpression(cdp, "document.querySelector('.primary-folder-list').innerText.includes('客户跟进')");
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
    await clickButton(cdp, '重点客户', "document.querySelector('.primary-folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('Quarterly update')");
    await clickButton(cdp, '撤销', "document.querySelector('.undo-snackbar')");
    await waitForExpression(cdp, "!document.querySelector('.undo-snackbar') && document.querySelector('.primary-folder-list .folder[data-folder-role=\"inbox\"] .folder-main[aria-current=\"page\"]') && document.body.innerText.includes('Quarterly update')");
    await openCardContextMenu(cdp, '安全检查清单');
    await clickContextSubmenuItem(cdp, '移动到', '重点客户');
    await waitForExpression(cdp, "document.body.innerText.includes('已移动到 重点客户')");
    await clickButton(cdp, '重点客户', "document.querySelector('.primary-folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await openCardContextMenu(cdp, '安全检查清单');
    await clickContextMenuItem(cdp, '移到废纸篓');
    await waitForExpression(cdp, "document.body.innerText.includes('已移到废纸篓：安全检查清单')");
    await clickButton(cdp, '废纸篓', "document.querySelector('.primary-folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await openCardContextMenu(cdp, '安全检查清单');
    await clickContextMenuItem(cdp, '恢复到收件箱');
    await waitForExpression(cdp, "document.body.innerText.includes('本地已恢复到收件箱') && document.body.innerText.includes('远端邮件已移动到 INBOX')");
    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await openCardContextMenu(cdp, 'Quarterly update');
    await clickContextMenuItem(cdp, '移到废纸篓');
    await waitForExpression(cdp, "document.body.innerText.includes('已移到废纸篓：Quarterly update')");
    await clickButton(cdp, '废纸篓', "document.querySelector('.primary-folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('Quarterly update')");
    await openCardContextMenu(cdp, 'Quarterly update');
    await clickContextMenuItem(cdp, '永久删除');
    await waitForExpression(cdp, "document.querySelector('.dialog-card') && document.querySelector('.dialog-card')?.innerText.includes('永久删除')");
    await clickButton(cdp, '确认', "document.querySelector('.dialog-card')");
    await waitForExpression(cdp, "document.body.innerText.includes('本地已永久删除') && document.body.innerText.includes('远端邮件已标记删除并 expunge')");
    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");
    await openCardContextMenu(cdp, '安全检查清单');
    await clickContextMenuItem(cdp, '标为垃圾邮件');
    await waitForExpression(cdp, "document.body.innerText.includes('已标为垃圾邮件')");
    await clickButton(cdp, '垃圾邮件', "document.querySelector('.primary-folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单') && document.querySelector('.folder.active')?.getAttribute('data-folder-role') === 'spam'");
    await openCardContextMenu(cdp, '安全检查清单');
    await clickContextMenuItem(cdp, '不是垃圾邮件');
    await waitForExpression(cdp, "document.body.innerText.includes('已标记为不是垃圾邮件：安全检查清单')");
    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");

    await openAccountSwitcherMenu(cdp, '[data-context-item="account-scope-3"]');
    await waitForExpression(cdp, "document.querySelector('[data-context-item=\"account-scope-3\"]')");
    await evalInPage(cdp, "document.querySelector('[data-context-item=\"account-scope-3\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.account-switcher[data-account-scope=\"3\"]')?.innerText.includes('archive@better-email.local')");
    await clickButton(cdp, '设置');
    await waitForExpression(cdp, "document.querySelector('.settings-title strong')?.textContent.trim() === '设置' && document.querySelector('.settings-page-header')?.innerText.includes('账号') && !document.body.innerText.includes('OAuth2 向导')");
    await waitForExpression(cdp, "document.querySelector('.settings-page')?.dataset.settingsPage === 'accounts' && document.querySelectorAll('.settings-page').length === 1 && document.querySelectorAll('.settings-nav-section > button').length === 14 && document.querySelector('.settings-nav-search input[aria-label^=\"搜索设置页面\"]')");
    await evalInPage(
      cdp,
      `(() => {
        const element = document.querySelector('.settings-nav-search input');
        if (!element) throw new Error('Settings search input not found');
        element.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter.call(element, '隐私');
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '隐私' }));
      })()`,
    );
    await waitForExpression(cdp, "document.querySelectorAll('.settings-nav-section > button').length === 1 && document.querySelector('.settings-nav-section > button')?.innerText.includes('隐私')");
    await evalInPage(cdp, "document.querySelector('.settings-nav-search button[aria-label=\"清空设置搜索\"]').click()");
    await waitForExpression(cdp, "document.querySelectorAll('.settings-nav-section > button').length === 14");
    await evalInPage(cdp, "document.querySelector('.settings-page-picker').click()");
    await waitForExpression(cdp, "document.querySelector('.settings-mobile-menu') && [...document.querySelectorAll('.settings-mobile-menu [role=\"menuitem\"]')].some((item) => item.innerText.includes('发送'))");
    await evalInPage(cdp, "[...document.querySelectorAll('.settings-mobile-menu [role=\"menuitem\"]')].find((item) => item.innerText.includes('发送')).click()");
    await waitForExpression(cdp, "!document.querySelector('.settings-mobile-menu') && document.querySelector('.settings-page')?.dataset.settingsPage === 'sending' && document.querySelector('.settings-page-header h2')?.textContent.trim() === '发送'");
    await evalInPage(cdp, "document.querySelector('.settings-page-picker').click()");
    await waitForExpression(cdp, "document.querySelector('.settings-mobile-menu') && [...document.querySelectorAll('.settings-mobile-menu [role=\"menuitem\"]')].some((item) => item.innerText.includes('账号'))");
    await evalInPage(cdp, "[...document.querySelectorAll('.settings-mobile-menu [role=\"menuitem\"]')].find((item) => item.innerText.includes('账号')).click()");
    await waitForExpression(cdp, "!document.querySelector('.settings-mobile-menu') && document.querySelector('.settings-page')?.dataset.settingsPage === 'accounts' && document.querySelector('.settings-page-header h2')?.textContent.trim() === '账号'");
    await clickButton(cdp, '发送', "document.querySelector('.settings-nav')");
    await waitForExpression(cdp, "document.querySelector('.settings-page')?.dataset.settingsPage === 'sending' && document.querySelector('.settings-page-header h2')?.textContent.trim() === '发送'");
    await clickButton(cdp, '账号', "document.querySelector('.settings-nav')");
    await waitForExpression(cdp, "document.querySelector('.settings-page')?.dataset.settingsPage === 'accounts' && document.querySelector('.settings-page-header h2')?.textContent.trim() === '账号'");
    await clickButton(cdp, '认证', "document.querySelector('.settings-connection-tabs')");
    await waitForExpression(cdp, "document.querySelector('.settings-page')?.dataset.settingsPage === 'auth' && document.querySelector('.settings-oauth-primary')");
    await openDetails(cdp, '.settings-provider-advanced');
    await assertSettingsAuthOAuth2Alignment(cdp, '认证 OAuth2 模式 1440x980');
    await fillInput(cdp, '.settings-provider-advanced-content input[placeholder*="Client ID"]', 'smoke-client-id');
    await clickButton(cdp, '开始授权', "document.querySelector('.settings-oauth-primary')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"auth\"]')?.innerText.includes('outlook · Session #1') && [...document.querySelectorAll('.settings-oauth-result')].some((el) => el.textContent.includes('Session #1')) && !document.querySelector('.oauth-result') && document.querySelector('.settings-oauth-sessions')?.innerText.includes('authorization_pending')");
    await fillInput(cdp, '.settings-oauth-callback input[placeholder="回调 state"]', 'mock-state-1');
    await fillInput(cdp, '.settings-oauth-callback input[placeholder="授权码 code"]', 'smoke-authorization-code');
    await clickButton(cdp, '记录回调授权码', "document.querySelector('.settings-oauth-callback')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"auth\"]')?.innerText.includes('code_received') && [...document.querySelectorAll('.settings-oauth-result')].some((el) => el.textContent.includes('code_received')) && !document.querySelector('.oauth-result') && document.querySelector('.settings-oauth-sessions')?.innerText.includes('交换并保存 Token')");
    await clickButton(cdp, '交换并保存 Token', "document.querySelector('.settings-oauth-sessions')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"auth\"]')?.innerText.includes('token_stored') && [...document.querySelectorAll('.settings-oauth-result')].some((el) => el.textContent.includes('token_stored')) && !document.querySelector('.oauth-result')");
    await clickButton(cdp, '刷新已保存 Token', "document.querySelector('.settings-page[data-settings-page=\"auth\"]')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"auth\"]')?.innerText.includes('refreshed') && [...document.querySelectorAll('.settings-oauth-result')].some((el) => el.textContent.includes('refreshed')) && !document.querySelector('.oauth-result') && document.querySelector('.status-line')?.textContent.includes('OAuth2 Token 已刷新')");
    await assertOAuthResultCardGeometry(cdp, 'OAuth 结果卡 1440x980');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1180,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 1180');
    await waitForSettingsPageStable(cdp);
    await assertOAuthResultCardGeometry(cdp, 'OAuth 结果卡 1180x760');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430,
      height: 780,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 430');
    await waitForSettingsPageStable(cdp);
    await assertOAuthResultCardGeometry(cdp, 'OAuth 结果卡 430x780');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 1440');
    await waitForSettingsPageStable(cdp);
    await evalInPage(cdp, "(() => { const button = document.querySelector('.settings-modal header button[aria-label=\"关闭设置\"]') ?? [...document.querySelectorAll('.settings-modal header button')].find((item) => item.textContent.includes('关闭')); if (!button) throw new Error('Settings close button not found'); button.click(); })()");

    await openAccountSwitcherMenu(cdp, '[data-context-item="account-scope-2"]');
    await waitForExpression(cdp, "document.querySelector('[data-context-item=\"account-scope-2\"]')");
    await evalInPage(cdp, "document.querySelector('[data-context-item=\"account-scope-2\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.account-switcher[data-account-scope=\"2\"]')?.innerText.includes('design@better-email.local') && document.querySelector('.account-switcher[data-account-scope=\"2\"]')?.innerText.includes('iCloud')");
    await evalInPage(
      cdp,
      "document.querySelector('.account-switcher-trigger').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 120, button: 2 }))",
    );
    await waitForExpression(cdp, "document.querySelector('[data-context-item=\"set-default-account\"]')?.innerText.includes('设为默认发件账号')");
    await clickButton(cdp, '设为默认发件账号', "document.querySelector('.account-switcher-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('默认发件账号已设为：design@better-email.local') && document.querySelector('.account-switcher[data-account-scope=\"2\"]')?.innerText.includes('默认')");
    await openAccountSwitcherMenu(cdp, '[data-context-item="account-scope-2"]');
    await waitForExpression(cdp, "document.querySelector('[data-context-item=\"account-scope-2\"]')?.innerText.includes('默认发件') && document.querySelector('[data-context-item=\"set-default-account\"]').disabled");
    await evalInPage(cdp, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await clickButton(cdp, '设置');
    await waitForExpression(cdp, "document.querySelector('.settings-title strong')?.textContent.trim() === '设置' && document.querySelector('.settings-page-header h2')?.textContent.trim() === '账号' && document.querySelector('.settings-page[data-settings-page=\"accounts\"]') && [...document.querySelectorAll('[data-settings-section]')].every((item) => item.dataset.settingsSection === 'accounts')");
    // 账号页头部为干净的 v2 头：只保留关闭按钮，不再有旧版保存动作栏。
    await waitForExpression(cdp, "document.querySelector('.settings-header-actions button[aria-label=\"关闭设置\"]') && !document.querySelector('.settings-action-bar')");
    await waitForExpression(cdp, "!document.querySelector('.add-account-disclosure')?.open");
    await waitForSettingsPageStable(cdp);
    await captureScreenshot(cdp, 'settings-account-desktop');
    // 账号列表呈现 3 个种子账号（保存与验证动作在账号配置/认证页内）。
    await waitForExpression(cdp, "[...document.querySelectorAll('.settings-account-row')].filter((row) => row.innerText.includes('@better-email.local')).length === 3");
    await openSettingsSection(cdp, '备份', 'backup', '.settings-page[data-settings-page="backup"]');
    // 备份页核心内容：本地存储统计（连接端点/凭据验证在认证页单独断言）。
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"backup\"]') && document.querySelector('[data-storage-total]')");
    await openSettingsSection(cdp, '发送', 'sending', '.settings-page[data-settings-page="sending"]');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430,
      height: 780,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, "window.innerWidth === 430 && getComputedStyle(document.querySelector('.settings-nav')).display === 'none' && getComputedStyle(document.querySelector('.settings-mobile-toolbar')).display === 'block' && document.querySelector('.settings-page-picker[aria-label=\"切换设置页面\"]')?.getAttribute('aria-expanded') === 'false' && document.querySelector('.settings-page-picker')?.innerText.includes('发送') && document.querySelector('.settings-content').scrollWidth === document.querySelector('.settings-content').clientWidth");
    await waitForExpression(cdp, "(() => { const content = document.querySelector('.settings-content'); const toolbar = document.querySelector('.settings-mobile-toolbar'); const page = document.querySelector('.settings-page'); return content && toolbar && page && getComputedStyle(page).overflowY === 'auto' && page.clientHeight >= 200 && page.clientHeight <= content.clientHeight - toolbar.offsetHeight + 40; })()");
    await evalInPage(cdp, "document.querySelector('.settings-page-picker').click()");
    await waitForExpression(cdp, "document.querySelector('.settings-mobile-menu') && document.querySelectorAll('.settings-mobile-menu [role=\"menuitem\"]').length === 14 && document.querySelector('.settings-page-picker')?.getAttribute('aria-expanded') === 'true'");
    await captureScreenshot(cdp, 'settings-page-picker-narrow');
    await evalInPage(cdp, "[...document.querySelectorAll('.settings-mobile-menu [role=\"menuitem\"]')].find((item) => item.innerText.includes('发送')).click()");
    await waitForExpression(cdp, "!document.querySelector('.settings-mobile-menu') && document.querySelector('.settings-page')?.dataset.settingsPage === 'sending'");
    await waitForSettingsPageStable(cdp);
    await captureScreenshot(cdp, 'settings-sending-narrow');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, "window.innerWidth === 1440 && getComputedStyle(document.querySelector('.settings-nav')).display === 'flex' && getComputedStyle(document.querySelector('.settings-nav')).flexDirection === 'column' && getComputedStyle(document.querySelector('.settings-mobile-toolbar')).display === 'none'");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"sending\"] .custom-select-summary span')?.textContent.includes('10')");
    await pickCustomSelect(cdp, '.settings-page[data-settings-page="sending"] .custom-select-summary', '5 秒');
    await waitForExpression(cdp, "localStorage.getItem('better-email.sendUndoDelaySeconds') === '5' && document.querySelector('.settings-page[data-settings-page=\"sending\"]').innerText.includes('5 秒')");
    await clickButton(cdp, '账号', "document.querySelector('.settings-nav')");
    await waitForExpression(cdp, "document.querySelector('.settings-page')?.dataset.settingsPage === 'accounts' && document.querySelector('.settings-page-header h2')?.textContent.trim() === '账号'");
    await clickButton(cdp, '服务器', "document.querySelector('.settings-connection-tabs')");
    await waitForExpression(cdp, "document.querySelector('.settings-page')?.dataset.settingsPage === 'providers' && document.querySelector('.settings-provider-advanced')");
    await waitForExpression(cdp, "!document.querySelector('details[data-settings-section=\"providers\"]')?.open && [...document.querySelectorAll('.settings-nav button')].some((item) => item.textContent.trim() === '发送')");
    await waitForSettingsPageStable(cdp);
    await captureScreenshot(cdp, 'settings-providers-closed-desktop');
    await openDetails(cdp, 'details[data-settings-section=\"providers\"]');
    await waitForExpression(cdp, "document.querySelector('details[data-settings-section=\"providers\"]')?.open && document.querySelector('details[data-settings-section=\"providers\"]')?.textContent.includes('真实账号已验证') && document.body.innerText.includes('兼容性矩阵')");
    await waitForExpression(cdp, "(() => { const header = document.querySelector('.settings-page-header')?.getBoundingClientRect(); const content = document.querySelector('.settings-page-content')?.getBoundingClientRect(); return header && content && header.bottom <= content.top + 1; })()");
    await waitForSettingsPageStable(cdp);
    await captureScreenshot(cdp, 'settings-providers-desktop');
    await assertSettingsProvidersGeometry(cdp, '服务器页 1440x980');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1180,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 1180');
    await waitForSettingsPageStable(cdp);
    await assertSettingsProvidersGeometry(cdp, '服务器页 1180x760');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430,
      height: 780,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 430');
    await assertSettingsNoHorizontalOverflow(cdp, '服务器页 430x780');
    await assertSettingsV2LayoutContract(cdp, '服务器页 窄屏布局契约 430x780', 'narrow');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 1440');
    await waitForSettingsPageStable(cdp);
    await clickButton(cdp, '认证', "document.querySelector('.settings-connection-tabs')");
    await waitForExpression(cdp, "document.querySelector('.settings-credential-panel')?.innerText.includes('本地凭据存储') && document.querySelector('.credential-safety-points')?.innerText.includes('保存后立即清空输入框') && document.querySelector('.settings-credential-panel')?.innerText.includes('验证登录')");
    await waitForExpression(cdp, "document.querySelector('.settings-credential-panel .credential-guide-card') && document.querySelector('.credential-provider-tag')");
    await waitForSettingsPageStable(cdp);
    await captureScreenshot(cdp, 'settings-auth-desktop');
    await waitForExpression(cdp, "document.querySelector('.settings-auth-guide')?.innerText.includes('授权码模式')");
    await assertSettingsAuthAlignment(cdp, '认证 授权码模式 1440x980');
    await assertSettingsV2LayoutContract(cdp, '认证页 桌面布局契约 1440x980', 'desktop');
    await fillInput(cdp, '.credential-input-shell input', 'local-smoke-app-password');
    await waitForExpression(cdp, "document.querySelector('.settings-credential-panel')?.innerText.includes('保存并验证') && document.querySelector('.credential-input-tools button[aria-label=\"显示凭据\"]')");
    await evalInPage(cdp, "document.querySelector('.credential-input-tools button[aria-label=\"显示凭据\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.credential-input-shell input')?.type === 'text' && document.querySelector('.credential-input-tools button[aria-label=\"隐藏凭据\"]')");
    await evalInPage(cdp, "document.querySelector('.credential-input-tools button[aria-label=\"清空凭据输入\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.credential-input-shell input')?.value === '' && document.querySelector('.credential-input-shell input')?.type === 'password' && document.querySelector('.settings-credential-panel')?.innerText.includes('验证登录')");
    await clickButton(cdp, '验证登录', "document.querySelector('.settings-credential-panel')");
    await waitForExpression(cdp, "document.querySelector('[data-connection-diagnostics]')?.innerText.includes('账号连接已就绪') && [...document.querySelectorAll('[data-diagnostic-step]')].length === 4 && [...document.querySelectorAll('[data-diagnostic-step]')].every((step) => step.classList.contains('success')) && !document.querySelector('.connection-technical-details')?.open");
    await clickButton(cdp, '只读验收', "document.querySelector('[data-connection-diagnostics]')");
    await waitForExpression(cdp, "document.querySelector('[data-provider-validation-status=\"success\"]') && [...document.querySelectorAll('[data-provider-validation-stage]')].length === 4 && [...document.querySelectorAll('[data-provider-validation-stage]')].every((stage) => stage.classList.contains('success')) && document.querySelector('[data-provider-validation]')?.innerText.includes('未发送邮件或修改远端邮件状态')");
    await evalInPage(cdp, "document.querySelector('.connection-technical-details > summary').click()");
    await waitForExpression(cdp, "document.querySelector('.connection-technical-details')?.open && document.querySelector('.connection-technical-details')?.textContent.includes('未发送任何邮件') && document.querySelector('.connection-technical-details')?.textContent.includes('不显示或导出授权码与 Token')");
    await openSettingsSection(cdp, '同步', 'sync', '.settings-page[data-settings-page="sync"]');
    await waitForExpression(cdp, "document.body.innerText.includes('同步调度与限流') && document.body.innerText.includes('每轮最多 2 个账号') && document.body.innerText.includes('Smoke Outbox Flow') && document.body.innerText.includes('排队中')");
    await waitForSettingsPageStable(cdp);
    await captureScreenshot(cdp, 'settings-sync-desktop');
    await clickButton(cdp, '发现文件夹', "document.querySelector('.settings-page[data-settings-page=\"sync\"]')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"sync\"]')?.innerText.includes('design@better-email.local') && document.querySelector('.settings-page[data-settings-page=\"sync\"]')?.innerText.includes('4 个')");
    await waitForExpression(cdp, "document.querySelector('[data-imap-mailbox=\"Projects/Alpha\"]')?.innerText.includes('未映射')");
    await clickButton(cdp, '新建同名', "document.querySelector('[data-imap-mailbox=\"Projects/Alpha\"]')");
    await waitForExpression(cdp, "document.querySelector('[data-imap-mailbox=\"Projects/Alpha\"]')?.innerText.includes('已映射') && document.querySelector('[data-imap-mailbox=\"Projects/Alpha\"]')?.innerText.includes('等待首次同步') && document.querySelector('.custom-select-summary[aria-label=\"映射远端目录 Projects/Alpha\"]')");
    await clickButton(cdp, '回填一页', "document.querySelector('.settings-page[data-settings-page=\"sync\"]')");
    await waitForExpression(cdp, "document.querySelector('[data-imap-mailbox=\"Projects/Alpha\"]')?.innerText.includes('5750')");
    await clickButton(cdp, '演练', "document.querySelector('.settings-page[data-settings-page=\"sync\"]')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"sync\"]')?.innerText.includes('design@better-email.local')");
    await clickButton(cdp, '同步邮件头', "document.querySelector('.settings-page[data-settings-page=\"sync\"]')");
    await waitForExpression(cdp, "document.body.innerText.includes('4 个已映射文件夹')");
    await openSettingsSection(cdp, '通知', 'notifications', '.settings-page[data-settings-page="notifications"]');
    await waitForExpression(cdp, "document.body.innerText.includes('账号通知优先级') && document.body.innerText.includes('正常通知') && document.body.innerText.includes('优先提醒') && document.body.innerText.includes('不通知') && document.querySelector('.notification-account-grid')");
    await evalInPage(cdp, "(() => { const row = document.querySelector('[data-notification-account=\"design@better-email.local\"]'); const button = [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === '优先提醒'); if (!button) throw new Error('Priority notification button not found'); button.click(); })()");
    await waitForExpression(cdp, "(() => { const policy = JSON.parse(localStorage.getItem('better-email.notificationPolicy')); const row = document.querySelector('[data-notification-account=\"design@better-email.local\"]'); return policy.priorityAccounts.includes('design@better-email.local') && !policy.mutedAccounts.includes('design@better-email.local') && row.querySelector('button[aria-pressed=\"true\"]')?.textContent.trim() === '优先提醒'; })()");
    await evalInPage(cdp, "(() => { const row = document.querySelector('[data-notification-account=\"design@better-email.local\"]'); const button = [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === '不通知'); if (!button) throw new Error('Muted notification button not found'); button.click(); })()");
    await waitForExpression(cdp, "(() => { const policy = JSON.parse(localStorage.getItem('better-email.notificationPolicy')); const row = document.querySelector('[data-notification-account=\"design@better-email.local\"]'); return policy.mutedAccounts.includes('design@better-email.local') && !policy.priorityAccounts.includes('design@better-email.local') && row.querySelector('button[aria-pressed=\"true\"]')?.textContent.trim() === '不通知'; })()");
    await openSettingsSection(cdp, '隐私', 'privacy', '.settings-page[data-settings-page="privacy"]');
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"privacy\"] .custom-select-summary[aria-label=\"配置账号\"]') && document.querySelector('.settings-page[data-settings-page=\"privacy\"]')?.innerText.includes('允许此账号加载远程图片')");
    await openSettingsSection(cdp, '备份', 'backup', '.settings-page[data-settings-page="backup"]');
    await waitForExpression(cdp, "document.querySelector('[data-storage-total]')?.textContent !== '—' && document.querySelector('[data-storage-reclaimable]')?.textContent.includes('MB') && ![...document.querySelectorAll('.settings-storage-actions button')].find((item) => item.textContent.includes('清理缓存'))?.disabled");
    await waitForSettingsPageStable(cdp);
    await captureScreenshot(cdp, 'settings-storage-desktop');
    await clickButton(cdp, '清理缓存', "document.querySelector('.settings-storage-actions')");
    await waitForExpression(cdp, "document.querySelector('.settings-cache-confirm[role=\"dialog\"]')?.innerText.includes('本地导入且没有远端副本的附件不会被清理') && document.querySelector('.settings-cache-confirm-summary')?.innerText.includes('MB')");
    await captureScreenshot(cdp, 'settings-storage-confirm');
    await clickButton(cdp, '确认清理', "document.querySelector('.settings-cache-confirm')");
    await waitForExpression(cdp, "!document.querySelector('.settings-cache-confirm') && document.querySelector('[data-storage-reclaimable]')?.textContent === '0 B' && [...document.querySelectorAll('.settings-storage-actions button')].find((item) => item.textContent.includes('清理缓存'))?.disabled && document.querySelector('.status-line')?.textContent.includes('已释放')");
    await clickButton(cdp, '导入 EML');
    await waitForExpression(
      cdp,
      "document.querySelector('.status-line')?.textContent.includes('已导入 EML：Imported EML Sample') && [...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('Imported EML Sample'))",
    );
    await clickButton(cdp, '导出本地备份');
    await waitForExpression(cdp, "document.body.innerText.includes('/tmp/better-email-backup.json') && document.body.innerText.includes('凭据未包含')");

    await openSettingsSection(cdp, '联系人', 'contacts', '.settings-page[data-settings-page="contacts"]');
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"contacts\"] .contact-transfer-actions') && (document.querySelectorAll('.contact-tool-row').length > 0 || document.querySelector('.settings-page[data-settings-page=\"contacts\"]')?.innerText.includes('还没有联系人'))");
    const contactsNeedSeed = await evalInPage(cdp, "![...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('ada@example.com'))");
    if (contactsNeedSeed) {
      await openContactCreateDialog(cdp);
      await fillInput(cdp, '.contact-create-form input[placeholder="联系人名称"]', 'Ada');
      await fillInput(cdp, '.contact-create-form input[placeholder="name@example.com"]', 'ada@example.com');
      await clickButton(cdp, '确认添加', "document.querySelector('.contact-create-form')");
      await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('联系人已新增：Ada') && [...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('ada@example.com'))");
      await openContactCreateDialog(cdp);
      await fillInput(cdp, '.contact-create-form input[placeholder="联系人名称"]', 'Security Team');
      await fillInput(cdp, '.contact-create-form input[placeholder="name@example.com"]', 'security@example.com');
      await clickButton(cdp, '确认添加', "document.querySelector('.contact-create-form')");
      await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('联系人已新增：Security Team') && [...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('security@example.com'))");
    }
    await clickButton(cdp, '编辑', "[...document.querySelectorAll('.contact-tool-row')].find((row) => row.innerText.includes('ada@example.com'))");
    await waitForExpression(cdp, "document.querySelector('.contact-edit-form')");
    await fillInput(cdp, '.contact-edit-form input[placeholder="显示名称"]', 'Ada Lovelace');
    await fillInput(cdp, '.contact-edit-form textarea[placeholder="alias@example.com"]', 'ada@work.example.com');
    await clickButton(cdp, '保存', "document.querySelector('.contact-edit-form')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('联系人已更新：Ada Lovelace') && [...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('Ada Lovelace') && row.innerText.includes('ada@example.com'))");
    await evalInPage(cdp, "(() => { const row = [...document.querySelectorAll('.contact-tool-row')].find((item) => item.innerText.includes('ada@example.com')); const button = row?.querySelector('.settings-contact-main'); if (!button) throw new Error('Ada contact details trigger not found'); button.click(); })()");
    await waitForExpression(cdp, "document.querySelector('.settings-contact-dialog[role=\"dialog\"]')?.innerText.includes('ada@work.example.com')");
    await clickButton(cdp, '设为 VIP', "document.querySelector('.settings-contact-dialog')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('已设为 VIP：Ada Lovelace') && [...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('★ Ada Lovelace') && row.innerText.includes('ada@example.com')) && JSON.parse(localStorage.getItem('better-email.notificationPolicy')).vipSenders.includes('ada@work.example.com')");
    await evalInPage(cdp, "(() => { const button = document.querySelector('.settings-contact-dialog .settings-contact-dialog-close'); if (!button) throw new Error('Contact details close button not found'); button.click(); })()");
    await waitForExpression(cdp, "!document.querySelector('.settings-contact-dialog')");
    await openContactCreateDialog(cdp);
    await fillInput(cdp, '.contact-create-form input[placeholder="联系人名称"]', 'Delete Me');
    await fillInput(cdp, '.contact-create-form input[placeholder="name@example.com"]', 'delete-me@example.com');
    await clickButton(cdp, '确认添加', "document.querySelector('.contact-create-form')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('联系人已新增：Delete Me') && [...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('delete-me@example.com'))");
    await evalInPage(cdp, "(() => { const row = [...document.querySelectorAll('.contact-tool-row')].find((item) => item.innerText.includes('delete-me@example.com')); const button = row?.querySelector('.settings-contact-main'); if (!button) throw new Error('Delete Me contact details trigger not found'); button.click(); })()");
    await waitForExpression(cdp, "document.querySelector('.settings-contact-dialog[role=\"dialog\"]')?.innerText.includes('delete-me@example.com')");
    await clickButton(cdp, '删除', "document.querySelector('.settings-contact-dialog')");
    await waitForExpression(cdp, "document.querySelector('.dialog-card') && document.querySelector('.dialog-card')?.innerText.includes('删除联系人')");
    await clickButton(cdp, '确认', "document.querySelector('.dialog-card')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('联系人已删除：Delete Me') && !document.querySelector('.settings-modal').innerText.includes('delete-me@example.com')");
    await clickButton(cdp, '导入联系人', "document.querySelector('.contact-transfer-actions')");
    await clickButton(cdp, '选择文件', "document.querySelector('.contact-import-dialog')");
    await waitForExpression(cdp, "document.querySelector('.contact-import-preview-list') && document.querySelector('.contact-import-dialog')?.innerText.includes('导入预览') && document.querySelector('.contact-import-dialog')?.innerText.includes('新增 1') && document.querySelector('.contact-import-dialog')?.innerText.includes('无效 1')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.contact-import-preview-row')].some((row) => row.innerText.includes('import.new@example.com'))");
    await clickButton(cdp, '确认导入', "document.querySelector('.contact-import-dialog')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('联系人导入完成：新增 1、合并 0、跳过 1') && [...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('import.new@example.com')) && document.querySelector('.contact-import-result')");
    await clickButton(cdp, '查看导入记录', "document.querySelector('.contact-import-result')");
    await waitForExpression(cdp, "document.querySelector('.contact-import-history-dialog') && document.querySelector('.contact-import-history-dialog')?.innerText.includes('import-contacts.vcf') && document.querySelector('.contact-import-history-dialog')?.innerText.includes('新增 1')");
    await clickButton(cdp, '撤销本批新增', "document.querySelector('.contact-import-history-dialog')");
    await waitForExpression(cdp, "document.querySelector('.settings-cache-confirm')?.innerText.includes('撤销导入批次')");
    await clickButton(cdp, '确认撤销', "document.querySelector('.settings-cache-confirm')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('已撤销导入批次：删除 1 位新增联系人') && ![...document.querySelectorAll('.contact-tool-row')].some((row) => row.innerText.includes('import.new@example.com'))");
    await clickButton(cdp, '导出 vCard', "document.querySelector('.contact-transfer-actions')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('已导出') && document.querySelector('.status-line')?.textContent.includes('/tmp/better-email-contacts.vcf')");

    await openSettingsSection(cdp, '规则', 'rules', '.settings-page[data-settings-page="rules"]');
    await waitForExpression(cdp, "document.querySelector('.settings-rule-editor') && document.querySelector('.settings-rule-builder') && document.querySelector('.settings-rule-action-chips') && document.querySelector('.settings-rule-advanced') && document.querySelector('.settings-rule-item') && document.querySelector('.settings-page[data-settings-page=\"rules\"] .settings-rule-editor input[placeholder=\"规则名称\"]')");
    const ruleOverflow1440 = await evalInPage(
      cdp,
      `(() => {
        const page = document.querySelector('.settings-page');
        const content = document.querySelector('.settings-content');
        return {
          page: { scrollWidth: page.scrollWidth, clientWidth: page.clientWidth },
          content: { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth },
        };
      })()`,
    );
    console.log(`规则页 1440x980 溢出检查: ${JSON.stringify(ruleOverflow1440)}`);
    if (ruleOverflow1440.page.scrollWidth > ruleOverflow1440.page.clientWidth || ruleOverflow1440.content.scrollWidth > ruleOverflow1440.content.clientWidth) {
      throw new Error(`规则页 1440x980 横向溢出: ${JSON.stringify(ruleOverflow1440)}`);
    }
    await evalInPage(cdp, "(() => { const d = document.querySelector('.settings-rule-advanced'); d.open = true; d.dispatchEvent(new Event('toggle', { bubbles: true })); })()");
    await waitForExpression(cdp, "document.querySelector('.settings-rule-advanced')?.open");
    await evalInPage(cdp, "(() => { const d = document.querySelector('.settings-rule-advanced'); d.open = false; d.dispatchEvent(new Event('toggle', { bubbles: true })); })()");
    await waitForExpression(cdp, "!document.querySelector('.settings-rule-advanced')?.open");
    await evalInPage(cdp, "(() => { const d = document.querySelector('.settings-rule-advanced'); d.open = true; d.dispatchEvent(new Event('toggle', { bubbles: true })); })()");
    await waitForExpression(cdp, "document.querySelector('.settings-rule-advanced')?.open");
    await fillInput(cdp, '.settings-rule-editor input[placeholder="规则名称"]', 'Smoke Rule');
    await pickCustomSelect(cdp, '.settings-rule-builder .custom-select-summary[aria-label="规则条件字段"]', '主题');
    await fillInput(cdp, '.settings-rule-builder input[placeholder="关键词或邮箱"]', 'Smoke');
    await pickCustomSelect(cdp, '.settings-rule-builder .custom-select-summary[aria-label="规则标签动作"]', '工作');
    await clickButton(cdp, '加星标', "document.querySelector('.settings-rule-action-chips')");
    await waitForExpression(cdp, "document.querySelector('input[aria-label=\"规则条件语法\"]').value === 'subject contains Smoke' && document.querySelector('input[aria-label=\"规则动作语法\"]').value.includes('apply label 工作') && document.querySelector('input[aria-label=\"规则动作语法\"]').value.includes('star')");
    await clickButton(cdp, '新增规则', "document.querySelector('.settings-rule-editor')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('规则已保存：Smoke Rule') && document.querySelector('.settings-page[data-settings-page=\"rules\"]')?.innerText.includes('Smoke Rule')");
    await clickButton(cdp, '编辑', "[...document.querySelectorAll('.settings-rule-item')].find((item) => item.textContent.includes('Smoke Rule'))");
    await waitForExpression(cdp, "document.querySelector('.settings-rule-editor input[placeholder=\"规则名称\"]')?.value === 'Smoke Rule'");
    await fillInput(cdp, '.settings-rule-editor input[placeholder="规则名称"]', 'Smoke Rule 改');
    await clickButton(cdp, '更新规则', "document.querySelector('.settings-rule-editor')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('规则已保存：Smoke Rule 改') && [...document.querySelectorAll('.settings-rule-item')].some((item) => item.textContent.includes('Smoke Rule 改'))");
    await clickButton(cdp, '删除', "[...document.querySelectorAll('.settings-rule-item')].find((item) => item.textContent.includes('Smoke Rule 改'))");
    await waitForExpression(cdp, "document.querySelector('.dialog-card') && document.querySelector('.dialog-card')?.innerText.includes('删除规则')");
    await clickButton(cdp, '确认', "document.querySelector('.dialog-card')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('规则已删除：Smoke Rule 改') && ![...document.querySelectorAll('.settings-rule-item')].some((item) => item.textContent.includes('Smoke Rule 改'))");
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430,
      height: 780,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 430');
    await waitForSettingsPageStable(cdp);
    const ruleOverflow430 = await evalInPage(
      cdp,
      `(() => {
        const page = document.querySelector('.settings-page');
        const content = document.querySelector('.settings-content');
        return {
          page: { scrollWidth: page.scrollWidth, clientWidth: page.clientWidth },
          content: { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth },
        };
      })()`,
    );
    console.log(`规则页 430x780 溢出检查: ${JSON.stringify(ruleOverflow430)}`);
    if (ruleOverflow430.page.scrollWidth > ruleOverflow430.page.clientWidth || ruleOverflow430.content.scrollWidth > ruleOverflow430.content.clientWidth) {
      throw new Error(`规则页 430x780 横向溢出: ${JSON.stringify(ruleOverflow430)}`);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 1440');
    await waitForSettingsPageStable(cdp);

    await openSettingsSection(cdp, '安全预览', 'security-preview', '.settings-page[data-settings-page="security-preview"]');
    await waitForExpression(cdp, "[...document.querySelectorAll('.settings-page[data-settings-page=\"security-preview\"] button')].some((item) => item.textContent.includes('解析'))");
    await clickButton(cdp, '解析', "document.querySelector('.settings-page[data-settings-page=\"security-preview\"]')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"security-preview\"] .settings-preview-result')?.innerText.includes('安全预览样例') && document.querySelector('.settings-page[data-settings-page=\"security-preview\"] .settings-preview-result')?.innerText.includes('HTML 正文包含 script 标签') && document.querySelector('.settings-preview-result') && document.querySelector('.settings-sanitized-html-preview') && document.querySelector('.settings-sanitized-html-preview img') && document.querySelector('.settings-sanitized-html-preview p')?.textContent.includes('这是一封用于验证 MIME/HTML 安全预览的原始邮件') && document.querySelector('.settings-preview-result details') && document.querySelector('.settings-preview-result summary')");
    await waitForExpression(cdp, "document.querySelector('.settings-preview-metadata') && document.querySelector('.settings-preview-metadata span')?.textContent.includes('附件 1') && [...document.querySelectorAll('.settings-preview-metadata em')].some((item) => item.textContent.includes('security-checklist.pdf'))");
    const previewMetadata1440 = await evalInPage(
      cdp,
      `(() => {
        const container = document.querySelector('.settings-preview-metadata');
        const span = container?.querySelector(':scope > span');
        const em = container?.querySelector(':scope > em');
        const read = (el) => {
          if (!el) return null;
          const cs = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
            display: cs.display, flexWrap: cs.flexWrap, gap: cs.gap, alignItems: cs.alignItems,
            borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, color: cs.color,
            fontSize: cs.fontSize, fontStyle: cs.fontStyle, paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
            paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
            overflow: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth },
          };
        };
        return { container: read(container), span: read(span), em: read(em) };
      })()`,
    );
    console.log(`安全预览 metadata 1440x980: ${JSON.stringify(previewMetadata1440)}`);
    const metadataBad1440 = [previewMetadata1440.container, previewMetadata1440.span, previewMetadata1440.em]
      .some((entry) => entry && entry.overflow && entry.overflow.scrollWidth > entry.overflow.clientWidth);
    if (metadataBad1440) throw new Error(`安全预览 metadata 1440x980 横向溢出: ${JSON.stringify(previewMetadata1440)}`);
    const previewOverflow1440 = await evalInPage(
      cdp,
      `(() => {
        const page = document.querySelector('.settings-page');
        const content = document.querySelector('.settings-content');
        return {
          page: { scrollWidth: page.scrollWidth, clientWidth: page.clientWidth },
          content: { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth },
        };
      })()`,
    );
    console.log(`安全预览页 1440x980 溢出检查: ${JSON.stringify(previewOverflow1440)}`);
    if (previewOverflow1440.page.scrollWidth > previewOverflow1440.page.clientWidth || previewOverflow1440.content.scrollWidth > previewOverflow1440.content.clientWidth) {
      throw new Error(`安全预览页 1440x980 横向溢出: ${JSON.stringify(previewOverflow1440)}`);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430,
      height: 780,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 430');
    await waitForSettingsPageStable(cdp);
    const previewMetadata430 = await evalInPage(
      cdp,
      `(() => {
        const container = document.querySelector('.settings-preview-metadata');
        const span = container?.querySelector(':scope > span');
        const em = container?.querySelector(':scope > em');
        const read = (el) => {
          if (!el) return null;
          const cs = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return {
            rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
            display: cs.display, flexWrap: cs.flexWrap, gap: cs.gap, alignItems: cs.alignItems,
            borderRadius: cs.borderRadius, backgroundColor: cs.backgroundColor, color: cs.color,
            fontSize: cs.fontSize, fontStyle: cs.fontStyle, paddingTop: cs.paddingTop, paddingRight: cs.paddingRight,
            paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
            overflow: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth },
          };
        };
        return { container: read(container), span: read(span), em: read(em) };
      })()`,
    );
    console.log(`安全预览 metadata 430x780: ${JSON.stringify(previewMetadata430)}`);
    const metadataBad430 = [previewMetadata430.container, previewMetadata430.span, previewMetadata430.em]
      .some((entry) => entry && entry.overflow && entry.overflow.scrollWidth > entry.overflow.clientWidth);
    if (metadataBad430) throw new Error(`安全预览 metadata 430x780 横向溢出: ${JSON.stringify(previewMetadata430)}`);
    const previewOverflow430 = await evalInPage(
      cdp,
      `(() => {
        const page = document.querySelector('.settings-page');
        const content = document.querySelector('.settings-content');
        return {
          page: { scrollWidth: page.scrollWidth, clientWidth: page.clientWidth },
          content: { scrollWidth: content.scrollWidth, clientWidth: content.clientWidth },
        };
      })()`,
    );
    console.log(`安全预览页 430x780 溢出检查: ${JSON.stringify(previewOverflow430)}`);
    if (previewOverflow430.page.scrollWidth > previewOverflow430.page.clientWidth || previewOverflow430.content.scrollWidth > previewOverflow430.content.clientWidth) {
      throw new Error(`安全预览页 430x780 横向溢出: ${JSON.stringify(previewOverflow430)}`);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await waitForExpression(cdp, 'window.innerWidth === 1440');
    await waitForSettingsPageStable(cdp);

    await openSettingsSection(cdp, '同步', 'sync', '.settings-page[data-settings-page="sync"]');
    await clickButton(cdp, '撤回', "document.querySelector('.settings-page[data-settings-page=\"sync\"]')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('已撤回到草稿箱') && document.querySelector('.settings-page[data-settings-page=\"sync\"]')?.innerText.includes('已撤回到草稿箱')");

    await clickButton(cdp, '生成验证草稿', "document.querySelector('.settings-page[data-settings-page=\"sync\"]')");
    await waitForExpression(
      cdp,
      "!document.querySelector('.settings-modal') && [...document.querySelectorAll('.composer-recipient-chip-copy')].some((item) => item.getAttribute('title') === 'design@better-email.local') && document.querySelector('.composer input[aria-label=\"主题\"]')?.value.startsWith('[Better Email 验收]')",
    );
    await waitForExpression(cdp, "(() => { const rich = document.querySelector('.composer-richtext-body'); if (rich) return (rich.textContent ?? '').includes('此草稿不会自动发送'); const plain = document.querySelector('.composer textarea[placeholder=\\\"正文\\\"]'); return Boolean(plain && (plain.value ?? '').includes('此草稿不会自动发送')); })()");
    await waitForExpression(cdp, "(() => { const rich = document.querySelector('.composer-richtext-body'); if (rich) return (rich.textContent ?? '').includes('不要在主题、正文或附件中粘贴密码、授权码或 Token'); const plain = document.querySelector('.composer textarea[placeholder=\\\"正文\\\"]'); return Boolean(plain && (plain.value ?? '').includes('不要在主题、正文或附件中粘贴密码、授权码或 Token')); })()");
    await closeComposer(cdp);
    await clickButton(cdp, '设置');
    await waitForExpression(cdp, "document.querySelector('.settings-modal') && document.querySelector('.settings-header-actions')");
    await openSettingsSection(cdp, '同步', 'sync', '.settings-page[data-settings-page="sync"]');
    await waitForExpression(cdp, "(() => { const stored = JSON.parse(localStorage.getItem('better-email.providerWriteValidationIds.v1') || '{}'); const panel = document.querySelector('.write-validation-status'); const pageButtons = [...document.querySelectorAll('.settings-page[data-settings-page=\"sync\"] button')]; return Boolean(stored['2']) && panel?.dataset.writeValidationId === stored['2'] && panel.querySelectorAll('[data-validation-stage]').length === 5 && document.querySelector('.settings-page[data-settings-page=\"sync\"]')?.innerText.includes('核心步骤') && !pageButtons.find((button) => button.textContent.includes('刷新状态'))?.disabled && pageButtons.filter((button) => button.textContent.includes('定位')).every((button) => button.disabled); })()");
    await clickButton(cdp, '刷新状态', "document.querySelector('.settings-page[data-settings-page=\"sync\"]')");
    await waitForExpression(cdp, "document.querySelector('.status-line')?.textContent.includes('暂未找到已发送或收件副本') && document.querySelector('[data-validation-stage=\"smtp\"]')?.innerText.includes('真实发送仍需手动确认')");
    await waitForExpression(cdp, "document.querySelector('.writeback-validation-panel')?.innerText.includes('等待自发自收邮件') && document.querySelectorAll('[data-writeback-step]').length === 4 && [...document.querySelectorAll('[data-writeback-step-action]')].every((button) => button.disabled)");

    await assertSettingsPagesEnterable(cdp, 'settings-v2 五页可进入 1440x980', [
      { id: 'sending', label: '发送' },
      { id: 'ai', label: 'AI 服务' },
      { id: 'accounts', label: '账号' },
      { id: 'providers', label: '服务器', tab: true, headerLabel: '账号' },
      { id: 'auth', label: '认证', tab: true, headerLabel: '账号' },
    ]);
    await clickButton(cdp, '账号', "document.querySelector('.settings-nav')");
    await waitForExpression(cdp, "document.querySelector('.settings-page')?.dataset.settingsPage === 'accounts' && document.querySelector('.settings-page-header h2')?.textContent.trim() === '账号'");

    await openSettingsSection(cdp, '账号', 'accounts', '.settings-page[data-settings-page="accounts"]');
    // 账号页头部为干净的 v2 头契约：无旧版保存动作栏，保存与验证在账号配置/认证页内。
    await waitForExpression(cdp, "document.querySelector('.settings-header-actions button[aria-label=\"关闭设置\"]') && !document.querySelector('.settings-action-bar')");
    await evalInPage(cdp, "(() => { const button = document.querySelector('.settings-modal header button[aria-label=\"关闭设置\"]') ?? [...document.querySelectorAll('.settings-modal header button')].find((item) => item.textContent.includes('关闭')); if (!button) throw new Error('Settings close button not found'); button.click(); })()");
    await waitForExpression(cdp, "!document.querySelector('.settings-modal')");
    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('Design remote sync sample')");
    await evalInPage(
      cdp,
      "[...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Design remote sync sample')).click()",
    );
    await waitForExpression(cdp, "document.querySelector('.reader-more-menu') && document.querySelector('.reader-more-menu summary')");
    await openDetails(cdp, '.reader-more-menu');
    await waitForExpression(cdp, "[...document.querySelectorAll('.reader-more-menu button')].some((item) => item.textContent.trim() === 'Alpha')");
    await clickButton(cdp, 'Alpha', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.querySelector('.undo-snackbar')?.innerText.includes('远端邮件已移动到 Projects/Alpha')");
    await clickButton(cdp, '设置');
    await waitForExpression(cdp, "document.querySelector('.settings-modal')");
    await openSettingsSection(cdp, '账号', 'accounts', '.settings-page[data-settings-page="accounts"]');
    await clickButton(cdp, '添加账号', "document.querySelector('.settings-page[data-settings-page=\"accounts\"]')");
    await waitForExpression(cdp, "document.querySelector('.settings-account-add-dialog')");
    await fillInput(cdp, '.settings-account-add-dialog input[placeholder="name@example.com"]', 'qa-new@better-email.local');
    await clickButton(cdp, '手动配置', "document.querySelector('.settings-account-add-dialog')");
    await waitForExpression(cdp, "document.querySelector('.settings-account-add-dialog input[placeholder=\"默认使用邮箱地址\"]')");
    await fillInput(cdp, '.settings-account-add-dialog input[placeholder="默认使用邮箱地址"]', 'QA New');
    await clickButton(cdp, 'QQ 邮箱', "document.querySelector('.settings-account-add-dialog')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.settings-account-add-dialog input')].some((input) => input.value === 'imap.qq.com:993') && [...document.querySelectorAll('.settings-account-add-dialog input')].some((input) => input.value === 'smtp.qq.com:587')");
    await fillInput(cdp, '.settings-account-add-dialog input[autocomplete="new-password"]', 'qa-password-mock');
    await clickButton(cdp, '添加', "document.querySelector('.settings-account-add-dialog')");
    // 新建账号后应用会展示首次引导向导：跳过它以回到设置页。
    await waitForExpression(cdp, "document.querySelector('.first-run-onboarding-backdrop') || document.querySelector('.settings-account-list-panel')?.innerText.includes('qa-new@better-email.local')");
    await evalInPage(cdp, "(() => { const skip = [...document.querySelectorAll('.first-run-onboarding-backdrop button')].find((b) => b.textContent.includes('跳过全部')); if (skip) skip.click(); })()");
    await waitForExpression(cdp, "!document.querySelector('.first-run-onboarding-backdrop')");
    await waitForExpression(cdp, "document.querySelector('.settings-account-list-panel')?.innerText.includes('qa-new@better-email.local')");
    await waitForExpression(cdp, "document.querySelector('.account-switcher')?.innerText.includes('qa-new@better-email.local') && document.querySelector('.folder-list')?.innerText.includes('收件箱') && document.querySelector('.folder-list')?.innerText.includes('已发送') && document.querySelector('.folder-list')?.innerText.includes('草稿箱') && document.querySelector('.folder-list')?.innerText.includes('归档')");
    await openSettingsSection(cdp, '身份', 'identities', '.settings-page[data-settings-page="identities"]');
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"identities\"]')?.innerText.includes('QA New') && document.querySelector('.settings-page[data-settings-page=\"identities\"]')?.innerText.includes('1 个身份')");
    await openSettingsSection(cdp, '账号', 'accounts', '.settings-page[data-settings-page="accounts"]');
    await clickButton(cdp, '会话', "document.querySelector('.list-control-actions')");
    await waitForExpression(cdp, "document.querySelector('.thread-list') && document.querySelectorAll('.thread-card').length === 0");
    await clickButton(cdp, '邮件', "document.querySelector('.list-control-actions')");
    await waitForExpression(cdp, "document.querySelector('.message-list')");
    await evalInPage(cdp, "(() => { const row = [...document.querySelectorAll('.settings-account-row')].find((r) => r.innerText.includes('qa-new@better-email.local')); const deleteBtn = row && [...row.querySelectorAll('.settings-account-row-actions button')].find((button) => button.textContent.includes('删除')); if (!deleteBtn) throw new Error('Delete button for qa-new@better-email.local not found'); deleteBtn.click(); })()");
    await waitForExpression(cdp, "document.querySelector('[data-account-remove-dialog]') && document.querySelector('[data-account-remove-confirm]').disabled");
    const removalDialogGeometry = await evalInPage(cdp, `(() => {
      const manageDialog = document.querySelector('.settings-account-manage-dialog');
      const manageHeader = manageDialog?.querySelector(':scope > header');
      const dialog = document.querySelector('[data-account-remove-dialog]');
      const header = dialog?.querySelector(':scope > header');
      const footer = dialog?.querySelector(':scope footer');
      if (!manageDialog || !manageHeader || !dialog || !header || !footer) {
        throw new Error('Account removal dialog structure is incomplete');
      }
      const pageTransform = getComputedStyle(document.querySelector('.settings-page')).transform;
      if (pageTransform !== 'none') throw new Error('Settings page transform creates a clipping context: ' + pageTransform);
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const rects = Object.fromEntries([
        ['manageDialog', manageDialog],
        ['manageHeader', manageHeader],
        ['dialog', dialog],
        ['header', header],
        ['footer', footer],
      ].map(([name, element]) => {
        const rect = element.getBoundingClientRect();
        return [name, { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, height: rect.height }];
      }));
      const visible = [rects.manageDialog, rects.manageHeader, rects.dialog, rects.header, rects.footer].every((rect) => (
        rect.top >= 0 && rect.bottom <= viewport.height && rect.left >= 0 && rect.right <= viewport.width
      ));
      if (!visible) throw new Error('Account removal dialog is clipped: ' + JSON.stringify({ viewport, rects }));
      return { viewport, pageTransform, rects };
    })()`);
    console.log(`Account removal dialog geometry: ${JSON.stringify(removalDialogGeometry)}`);
    await captureScreenshot(cdp, 'settings-account-removal-confirm');
    await fillInput(cdp, 'input[aria-label="输入邮箱地址确认移除"]', 'wrong@better-email.local');
    await waitForExpression(cdp, "document.querySelector('[data-account-remove-confirm]').disabled");
    await fillInput(cdp, 'input[aria-label="输入邮箱地址确认移除"]', 'qa-new@better-email.local');
    await waitForExpression(cdp, "!document.querySelector('[data-account-remove-confirm]').disabled");
    await evalInPage(cdp, "document.querySelector('[data-account-remove-confirm]').click()");
    await waitForExpression(cdp, "!document.querySelector('.settings-modal') && document.body.innerText.includes('已移除 qa-new@better-email.local') && document.querySelector('.account-switcher[data-account-scope=\"2\"]')?.innerText.includes('design@better-email.local')");
    await openAccountSwitcherMenu(cdp, '[data-context-item="account-scope-all"]');
    await waitForExpression(cdp, "document.querySelector('[data-context-item=\"account-scope-all\"]')");
    await waitForExpression(cdp, "![...document.querySelectorAll('[data-context-item^=\"account-scope-\"]')].some((item) => item.innerText.includes('qa-new@better-email.local'))");
    await evalInPage(cdp, "document.querySelector('[data-context-item=\"account-scope-all\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.account-switcher[data-account-scope=\"all\"]')?.innerText.includes('统一邮箱')");

    await clickButton(cdp, '写邮件');
    await waitForExpression(cdp, "document.querySelector('.composer .custom-select-summary[aria-label=\"发件人\"]')");
    await fillInput(cdp, '.composer input[role=\"combobox\"]', 'ada@example.com');
    await fillInput(cdp, '.composer input[aria-label=\"主题\"]', 'Smoke Undo Send');
    await fillComposerBody(cdp, '撤销发送路径验证');
    await evalInPage(cdp, "document.querySelector('.composer .composer-send-primary').click()");
    await waitForExpression(cdp, "document.querySelector('.message-toast-undo')?.innerText.includes('秒后发送') && document.querySelector('.message-toast-undo')?.innerText.includes('Smoke Undo Send')");
    await clickButton(cdp, '撤回发送', "document.querySelector('.message-toast-undo')");
    await waitForExpression(cdp, "!document.querySelector('.message-toast-undo') && document.body.innerText.includes('已撤回发送：Smoke Undo Send')");
    await closeComposer(cdp);
    await clickButton(cdp, '草稿', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('Smoke Undo Send')");

    await clickButton(cdp, '写邮件');
    await fillInput(cdp, '.composer input[role=\"combobox\"]', 'ada@example.com');
    await fillInput(cdp, '.composer input[aria-label=\"主题\"]', 'Smoke Auto Send');
    await fillComposerBody(cdp, '延迟发送到期路径验证');
    await evalInPage(cdp, "document.querySelector('.composer .composer-send-primary').click()");
    await waitForExpression(cdp, "document.querySelector('.message-toast-undo')?.innerText.includes('Smoke Auto Send')");
    await waitForExpression(cdp, "!document.querySelector('.message-toast-undo') && document.body.innerText.includes('SMTP 发件箱发送完成')", 12_000);
    await closeComposer(cdp);
    await clickButton(cdp, '已发送', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('Smoke Auto Send')");
    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单')");

    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((button) => button.textContent.includes('安全检查清单')).click()");
    await waitForExpression(cdp, "document.querySelector('.reader-actions button[aria-label=\"归档\"]')");
    await evalInPage(cdp, "document.querySelector('.reader-actions button[aria-label=\"归档\"]').click()");
    await waitForExpression(cdp, "document.querySelector('.undo-snackbar') && document.body.innerText.includes('归档') && document.body.innerText.includes('撤销')");
    await evalInPage(
      cdp,
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true }))",
    );
    await waitForExpression(cdp, "document.body.innerText.includes('已撤销：归档') && document.body.innerText.includes('安全检查清单')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('Imported EML Sample'))");
    await evalInPage(
      cdp,
      "(() => { const card = [...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Imported EML Sample')); if (!card) throw new Error('Imported EML Sample card not found for reader refresh'); card.click(); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.reader-html')?.shadowRoot?.textContent.includes('本地 EML 已安全解析')");
    await evalInPage(
      cdp,
      "(() => { const card = [...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('安全检查清单')); if (!card) throw new Error('安全检查清单 card not found for reader refresh'); card.click(); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.quick-reply textarea')");
    await fillInput(cdp, '.quick-reply textarea', '收到，我会继续跟进。');
    await clickButton(cdp, '发送回复', "document.querySelector('.quick-reply')");
    await waitForExpression(cdp, "document.body.innerText.includes('快速回复将在 5 秒后发送') && document.querySelector('.quick-reply textarea').value === ''");
    await waitForExpression(
      cdp,
      "(() => { const calls = window.__betterEmailMockInvocations || []; const call = [...calls].reverse().find((entry) => entry.command === 'queue_outbox_message' && entry.args?.input?.subject === 'Re: 安全检查清单'); return call?.args?.threading?.in_reply_to === '<mock-1-1@better-email.local>' && call.args.threading.references === '<mock-1-1@better-email.local>'; })()",
    );
    await evalInPage(cdp, "(() => { const button = document.querySelector('.reader-message-actions button[aria-label=\"稍后处理\"]'); if (!button) throw new Error('Reader snooze action not found'); button.click(); })()");
    await waitForExpression(cdp, "document.querySelector('.snooze-dialog') && document.querySelectorAll('[data-snooze-preset]').length === 4 && document.querySelector('input[aria-label=\"自定义稍后处理时间\"]')");
    await evalInPage(cdp, "document.querySelector('[data-snooze-preset=\"tomorrow\"]').click()");
    await waitForExpression(cdp, "!document.querySelector('.snooze-dialog') && document.body.innerText.includes('已稍后处理到')");
    await clickButton(cdp, '稍后处理', "document.querySelector('.primary-folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单') && document.body.innerText.includes('稍后到')");
    await evalInPage(cdp, "(() => { const button = document.querySelector('.reader-message-actions button[aria-label=\"取消稍后处理\"]'); if (!button) throw new Error('Reader unsnooze action not found'); button.click(); })()");
    await waitForExpression(cdp, "document.body.innerText.includes('已取消稍后处理') && document.body.innerText.includes('安全检查清单')");
    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "document.querySelectorAll('.message-card').length >= 2 && [...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('安全检查清单'))");
    await waitForExpression(cdp, "[...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('Imported EML Sample'))");
    await evalInPage(
      cdp,
      "(() => { const card = [...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Imported EML Sample')); if (!card) throw new Error('Imported EML Sample card not found for reader refresh'); card.click(); })()",
    );
    await waitForExpression(cdp, "document.querySelector('.reader-html')?.shadowRoot?.textContent.includes('本地 EML 已安全解析')");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('安全检查清单')).click()");
    await waitForExpression(cdp, "document.querySelector('.reader-html') && document.querySelector('.reader-more-menu')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '导出 EML', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('邮件已导出为 /tmp/安全检查清单.eml')");
    await openDetails(cdp, 'article .label-menu');
    await clickButton(cdp, '重要', "document.querySelector('article .label-menu')");
    await waitForExpression(cdp, "!document.querySelector('article .label-menu button.label-select-btn.active')");
    await openDetails(cdp, 'article .label-menu');
    await clickButton(cdp, '重要', "document.querySelector('article .label-menu')");
    await waitForExpression(cdp, "document.querySelector('article .label-menu button.label-select-btn.active')");
    await waitForExpression(
      cdp,
      "document.querySelector('.reader-html')?.shadowRoot?.querySelector('img[src=\"/inline-image-preview.svg\"]')",
      10_000,
    );
    await evalInPage(
      cdp,
      "document.querySelector('.reader-html')?.shadowRoot?.querySelector('img[src=\"/inline-image-preview.svg\"]')?.scrollIntoView({ block: 'center', inline: 'nearest' })",
    );
    await waitForExpression(
      cdp,
      "(() => { const host = document.querySelector('.reader-html'); const image = host?.shadowRoot?.querySelector('img[src=\"/inline-image-preview.svg\"]'); const attachmentText = document.querySelector('.attachments')?.innerText || ''; return image?.complete && image.naturalWidth > 0 && document.querySelectorAll('.attachments > div').length === 1 && attachmentText.includes('security-checklist.pdf') && !attachmentText.includes('better-email-inline-logo'); })()",
      15_000,
    );
    await clickButton(cdp, '下载全部 1 个', "document.querySelector('.attachment-section-header')");
    await waitForExpression(cdp, "document.querySelector('.attachment-transfer-status')?.innerText.includes('64 KB 下载进度') && [...document.querySelectorAll('.attachments button')].some((item) => item.textContent.includes('重试')) && document.body.innerText.includes('附件下载失败')");
    await evalInPage(cdp, "document.querySelectorAll('details[open]').forEach((item) => { item.open = false; }); document.querySelector('button[aria-label=\"关闭撤销提示\"]')?.click();");
    await captureScreenshot(cdp, 'attachment-download-retry');
    await clickButton(cdp, '重试', "document.querySelector('.attachments')");
    await waitForExpression(cdp, "document.body.innerText.includes('附件已从 64 KB 继续下载：security-checklist.pdf') && document.body.innerText.includes('打开')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '转发', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.querySelector('.composer') && document.querySelector('.composer input[aria-label=\"主题\"]')?.value === 'Fwd: 安全检查清单' && document.querySelector('.composer-attachment-list')?.innerText.includes('security-checklist.pdf') && document.querySelector('.status-line')?.textContent.includes('已带入 1 个附件')");
    await captureScreenshot(cdp, 'forward-with-source-attachment');
    await closeComposer(cdp);
    await openCardContextMenu(cdp, '安全检查清单');
    await clickContextMenuItem(cdp, '标为垃圾邮件');
    await waitForExpression(cdp, "document.body.innerText.includes('已标为垃圾邮件：安全检查清单')");
    await clickButton(cdp, '垃圾邮件', "document.querySelector('.primary-folder-list')");
    await waitForExpression(cdp, "document.body.innerText.includes('安全检查清单') && document.querySelector('.folder.active')?.getAttribute('data-folder-role') === 'spam'");
    await openCardContextMenu(cdp, '安全检查清单');
    await waitForExpression(cdp, "[...document.querySelectorAll('.context-menu button')].some((item) => item.textContent.includes('不是垃圾邮件'))");
    await clickContextMenuItem(cdp, '不是垃圾邮件');
    await waitForExpression(cdp, "document.body.innerText.includes('已标记为不是垃圾邮件：安全检查清单')");

    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('安全检查清单'))");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('安全检查清单')).click()");
    await waitForExpression(cdp, "document.querySelector('.reader-more-menu')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '信任发件人', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.body.innerText.includes('已信任发件人远程图片：security@example.com')");
    await openDetails(cdp, '.reader-more-menu');
    await clickButton(cdp, '阻止该发件人', "document.querySelector('.reader-more-menu')");
    await waitForExpression(cdp, "document.querySelector('.folder.active[data-folder-role=\"spam\"]') && [...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('安全检查清单'))");

    await clickButton(cdp, '设置');
    await waitForExpression(cdp, "document.querySelector('.settings-title strong')?.textContent.trim() === '设置'");
    await clickButton(cdp, '隐私', "document.querySelector('.settings-nav')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"privacy\"]') && document.body.innerText.includes('拦截外部邮箱邮件') && document.body.innerText.includes('隐藏邮件中的链接')");
    await pickCustomSelect(cdp, '.settings-page[data-settings-page="privacy"] .custom-select-summary[aria-label="配置账号"]', 'demo@better-email.local');
    await evalInPage(cdp, "(() => { const boxes = [...document.querySelectorAll('.settings-page[data-settings-page=\"privacy\"] input[type=\"checkbox\"]')]; const target = boxes[1]; if (!target) throw new Error('External mailbox toggle not found'); target.click(); })()");
    await waitForExpression(cdp, "[...document.querySelectorAll('.settings-page[data-settings-page=\"privacy\"] input[type=\"checkbox\"]')][1]?.checked");
    await clickButton(cdp, '账号', "document.querySelector('.settings-nav')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"accounts\"]') && document.querySelector('.settings-header-actions')?.innerText.includes('保存修改')");
    await clickButton(cdp, '保存修改', "document.querySelector('.settings-header-actions')");
    await waitForExpression(cdp, "(() => { const calls = window.__betterEmailMockInvocations || []; const call = [...calls].reverse().find((e) => e.command === 'update_account_settings'); return call?.args?.input?.block_external_mailboxes === true; })()");
    await evalInPage(cdp, "(() => { const button = document.querySelector('.settings-modal header button[aria-label=\"关闭设置\"]') ?? [...document.querySelectorAll('.settings-modal header button')].find((item) => item.textContent.includes('关闭')); if (!button) throw new Error('Settings close button not found'); button.click(); })()");
    await clickButton(cdp, '垃圾邮件', "document.querySelector('.primary-folder-list')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('安全检查清单'))");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('安全检查清单')).click()");
    await waitForExpression(cdp, "document.body.innerText.includes('外部邮箱已拦截') && ![...document.querySelectorAll('.reader-warning-panel button')].some((item) => item.textContent.includes('显示图片')) && ![...document.querySelectorAll('.reader-warning-panel button')].some((item) => item.textContent.includes('查看链接'))");

    await clickButton(cdp, '收件箱', "document.querySelector('.folder-list')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('Design review invitation'))");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Design review invitation')).click()");
    await waitForExpression(cdp, "document.querySelector('.reader-translate-action')");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Low memory digest 01')).click()");
    await waitForExpression(cdp, "!document.querySelector('.reader-translate-action')");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Design review invitation')).click()");
    await waitForExpression(cdp, "document.querySelector('.reader-translate-action')");
    await evalInPage(cdp, "localStorage.setItem('better-email.aiService', JSON.stringify({ enabled: true, serviceType: 'mock', endpoint: '', apiKey: '', defaultModel: 'gpt-4o-mini', timeoutSeconds: 30, privacyAcknowledged: false })); location.reload()");
    await waitForExpression(cdp, "document.querySelector('.app-shell') && document.body.innerText.includes('Better Email')");
    await waitForExpression(cdp, "[...document.querySelectorAll('.message-card')].some((item) => item.textContent.includes('Design review invitation'))");
    await evalInPage(cdp, "[...document.querySelectorAll('.message-card')].find((item) => item.textContent.includes('Design review invitation')).click()");
    await waitForExpression(cdp, "document.querySelector('.reader-translate-action')");
    await evalInPage(cdp, "(() => { const button = document.querySelector('.reader-actions button[aria-label=\"翻译为中文\"]'); if (!button) throw new Error('Translate button not found'); button.click(); })()");
    await waitForExpression(cdp, "document.querySelector('.reader-translation-panel')?.innerText.includes('mock 译文') && !document.querySelector('.reader-translation-panel')?.innerText.includes('Design review')");
    await clickButton(cdp, '查看原文', "document.querySelector('.reader-translation-header')");
    await waitForExpression(cdp, "document.querySelector('.reader-translation-panel')?.innerText.includes('已翻译为中文')");
    await clickButton(cdp, '显示译文', "document.querySelector('.reader-translation-banner')");
    await waitForExpression(cdp, "document.querySelector('.reader-translation-panel')?.innerText.includes('mock 译文')");

    await evalInPage(cdp, "(() => { const button = document.querySelector('.reader-actions button[title=\"回复\"]') ?? document.querySelector('.reader-actions button[aria-label=\"回复\"]'); if (!button) throw new Error('Reply button not found'); button.click(); })()");
    await waitForExpression(cdp, "document.querySelector('.composer') && [...document.querySelectorAll('.composer-recipient-chip-copy')].some((item) => item.getAttribute('title') === 'alice@partner.example.com')");
    await waitForExpression(cdp, "!document.querySelector('.composer-risk-banner')");
    await pickCustomSelect(cdp, '.composer .custom-select-summary[aria-label="发件人"]', 'design@better-email.local');
    await waitForExpression(cdp, "document.querySelector('.composer-risk-banner')?.innerText.includes('正在回复其他账号的邮件')");
    await evalInPage(cdp, "document.querySelector('.composer .composer-send-primary').click()");
    await waitForExpression(cdp, "document.querySelector('.dialog-card')?.innerText.includes('跨邮箱发送风险')");
    await clickButton(cdp, '返回修改', "document.querySelector('.dialog-card')");
    await waitForExpression(cdp, "!document.querySelector('.dialog-card') && document.querySelector('.composer')");
    await pickCustomSelect(cdp, '.composer .custom-select-summary[aria-label="发件人"]', 'demo@better-email.local');
    await waitForExpression(cdp, "!document.querySelector('.composer-risk-banner')");
    await closeComposer(cdp);

    await clickButton(cdp, '设置');
    await waitForExpression(cdp, "document.querySelector('.settings-modal')");
    await openSettingsSection(cdp, 'AI 服务', 'ai', '.settings-page[data-settings-page="ai"]');
    await sleep(800);
    await evalInPage(cdp, "(() => { const checkbox = [...document.querySelectorAll('.settings-page[data-settings-page=\"ai\"] input[type=\"checkbox\"]')][0]; if (!checkbox) throw new Error('AI enable checkbox not found'); if (!checkbox.checked) checkbox.click(); })()");
    await waitForExpression(cdp, "[...document.querySelectorAll('.settings-page[data-settings-page=\"ai\"] input[type=\"checkbox\"]')][0]?.checked");
    await pickCustomSelect(cdp, '.settings-page[data-settings-page="ai"] .custom-select-summary', '本地演示模式 (Mock)');
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"ai\"] .custom-select-summary')?.innerText.includes('本地演示模式 (Mock)')");
    await clickButton(cdp, '测试连接', "document.querySelector('.settings-page[data-settings-page=\"ai\"]')");
    await waitForExpression(cdp, "document.querySelector('.settings-ai-test-result.ok')?.innerText.includes('模拟 AI 服务连接正常')");
    await openSettingsSection(cdp, '模板', 'templates', '.settings-page[data-settings-page="templates"]');
    await waitForExpression(cdp, "[...document.querySelectorAll('.settings-page[data-settings-page=\"templates\"] button')].some((item) => item.textContent.includes('新建模板'))");
    await clickButton(cdp, '新建模板', "document.querySelector('.settings-page[data-settings-page=\"templates\"]')");
    await waitForExpression(cdp, "document.querySelector('.template-editor')");
    await fillInput(cdp, '.template-editor input[placeholder=\"模板名称\"]', 'Smoke 设置模板');
    await fillInput(cdp, '.template-editor input[placeholder^=\"邮件主题\"]', '你好 {{contact.name}}');
    await fillInput(cdp, '.template-editor textarea', '您好 {{contact.name}}，\n\n这是模板正文。\n\n{{signature}}');
    await clickButton(cdp, '保存模板', "document.querySelector('.template-editor')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"templates\"]')?.innerText.includes('Smoke 设置模板') && document.querySelector('.settings-inline-status')?.textContent.includes('模板已保存：Smoke 设置模板')");
    await clickButton(cdp, 'AI 生成', "document.querySelector('.settings-page[data-settings-page=\"templates\"]')");
    await waitForExpression(cdp, "document.querySelector('.template-ai-body')");
    await fillInput(cdp, '.template-ai-generator input[placeholder^=\"描述模板用途\"]', '向新客户介绍产品');
    await clickButton(cdp, 'AI 生成', "document.querySelector('.template-ai-generator')");
    await sleep(1000);
    await waitForExpression(cdp, "document.querySelector('.template-ai-preview textarea')?.value.includes('{{contact.name}}') && document.querySelector('.template-ai-preview input')?.value.includes('跟进')");
    await clickButton(cdp, '保存为模板', "document.querySelector('.template-ai-preview')");
    await waitForExpression(cdp, "document.querySelector('.settings-page[data-settings-page=\"templates\"]')?.innerText.includes('AI 生成的模板已保存') && document.querySelector('.settings-page[data-settings-page=\"templates\"]')?.innerText.includes('向新客户介绍产品模板')");
    await evalInPage(cdp, "(() => { const button = document.querySelector('.settings-modal header button[aria-label=\"关闭设置\"]') ?? [...document.querySelectorAll('.settings-modal header button')].find((item) => item.textContent.includes('关闭')); if (!button) throw new Error('Settings close button not found'); button.click(); })()");
    await waitForExpression(cdp, "!document.querySelector('.settings-modal')");

    await captureComposeReferenceFixture(cdp);

    if (checks.some((ok) => !ok)) throw new Error(`UI smoke checks failed: ${JSON.stringify(checks)}`);

    const report = {
      status: 'ok',
      url,
      assertions: [
        'main shell rendered',
        'Better Email brand mark rendered',
        'legacy SwiftMail settings migrate to better-email keys',
        'resizable panes persist across reload',
        'modern account switcher menu works',
        'more mailbox list stays inside sidebar',
        'favorite mailbox pin persists and can be removed',
        'unread filter auto-read clears unread dot without removing current result',
        'folder context menu marks all messages read',
        'folder context menu empties trash',
        'shortcut help opens from button and keyboard',
        'command palette opens and runs commands',
        'message list loaded',
        'single-message star syncs remote flagged state',
        'message context menu copies sender and subject',
        'reader warning displayed',
        'search works',
        'search scope switches folder account and all accounts',
        'saved search shortcuts work',
        'sidebar contact search stays removed',
        'contact settings edit opens',
        'contact command palette compose works',
        'mobile message list has a touch-scrolling owner',
        'mobile search dismissal clears its browser history state',
        'mobile mailbox sheet closes before compose and exposes contact picker',
        'mobile reader owns a touch-scrolling surface',
        'mobile settings root and section navigation return through browser history',
        'recipient autocomplete works',
        'recipient rows keep hover geometry',
        'composer templates and more use anchored overlays without an advanced details panel',
        'composer contacts rail opens and searches empty state',
        'composer contact rail exposes active state and target semantics',
        'composer schedule picker replaces native datetime control',
        'composer autosave restores after reload',
        'composer templates save and insert',
        'composer attachment chips work',
        'composer drag drop attachments work',
        'composer minimize restore works',
        'composer rich text html works',
        'composer sender identity selector works',
        'composer signature insertion works',
        'composer draft save syncs remote drafts',
        'bulk star and label actions work',
        'keyboard select all bulk action and escape clear work',
        'thread view opens conversations',
        'thread actions and context menu work',
        'thread mute persists and remains available from reader actions',
        'thread scope follows search and active account',
        'message drag drop move and undo works',
        'custom folder create rename and move works',
        'trash restore syncs the remote inbox',
        'permanent delete syncs remote expunge',
        'manual spam and not-spam correction works',
        'reader sender trust and block actions work',
        'reader translation offered only for foreign mails and toggles original/translated',
        'cross-account send risk banner and confirm dialog work',
        'ai service settings save and test connection',
        'template settings manage and ai-generate templates',
        'outbox queue and cancel works',
        'settings modal opens',
        'settings navigation renders one page at a time',
        'settings desktop sidebar switches standalone pages',
        'settings narrow layout uses grouped page selector',
        'settings page hierarchy stays isolated from legacy header and footer styles',
        'settings v2 provider and auth cards stay edge-aligned at desktop sizes',
        'settings v2 compatibility matrix stays inside advanced content without legacy margins',
        'settings v2 content column has no horizontal overflow on narrow viewports',
        'settings v2 desktop and narrow layout contracts hold',
        'settings v2 five core pages stay enterable',
        'settings low-frequency account creation stays folded and background feedback stays hidden',
        'settings connection test only appears on relevant pages',
        'settings primary sections open without redundant disclosure',
        'settings primary actions stay visible in header',
        'settings header save completes update flow',
        'storage management separates database cache and protected local attachments',
        'attachment cache clear uses confirmation and preserves recoverable data boundaries',
        'new account preset creation and scope switch work',
        'new account default folders and identity are available',
        'account removal requires exact email confirmation',
        'account removal clears scope and switches to a remaining account',
        'account switcher right click sets and labels default sender account',
        'unified compose uses the configured default sender account',
        'oauth pkce callback exchange and refresh flow works',
        'settings v2 oauth result cards own namespaced classes',
        'settings v2 oauth result cards preserve style and overflow contracts across viewports',
        'multi-account diagnostics target selected account',
        'provider-aware secure credential controls protect and clear local input',
        'provider-aware credential diagnostics guide recovery and fold technical details',
        'read-only provider validation runs connection login folder and header checks',
        'write validation prepares a self-addressed draft without automatic sending',
        'write validation tracker persists id and refreshes five-stage status',
        'writeback validation guide gates read star archive and restore safely',
        'remote custom mailbox creates and maps a local folder',
        'manual sync scans multiple mapped folders',
        'mapped custom mailbox resolves as a remote move target',
        'undo send delay settings persist',
        'undo send returns message to drafts',
        'scheduled send automatically flushes to sent',
        'local EML import works',
        'local backup export works',
        'contact create edit detail delete and VIP sync works',
        'contact vCard import export works',
        'rules create flow works',
        'settings v2 rule automation page owns namespaced rule classes',
        'rule editor create edit delete flows and advanced toggle work',
        'raw MIME preview works',
        'settings v2 security preview page owns namespaced preview classes',
        'settings v2 security preview metadata tags own namespaced styles',
        'snooze and unsnooze flow works',
        'global keyboard undo restores archived message',
        'inline quick reply sends from reader',
        'inline quick reply preserves standard thread headers',
        'message EML export works',
        'label toggle works',
        'downloaded CID image renders inside the body without entering the attachment list',
        'sequential download all preserves failure resume and retry flow',
        'forward draft carries downloaded source attachments',
        'blocked sender rule moves message to spam',
        'remote image sender trust re-renders reader',
      ],
    };
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(`UI smoke failed at ${currentStep}; elapsed=${formatDuration(Date.now() - startedAt)}; ${error?.message ?? error}`);
    if (cdp) {
      try {
        await captureScreenshot(cdp, 'failure-debug');
        console.error('Captured failure screenshot as ./tmp-ui-qa/failure-debug.png');
        const text = await evalInPage(cdp, "document.body.innerText");
        console.error('Page text content on failure:\n', text);
      } catch (e) {
        console.error('Failed to capture debug info:', e);
      }
    }
    throw error;
  } finally {
    stopWatchdog();
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
