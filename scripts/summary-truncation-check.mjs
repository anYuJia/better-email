import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * 真实浏览器渲染验证：邮件列表正文摘要必须始终只有一行。
 * 用 headless Chrome 加载包含真实级联 CSS 的 fixture，
 * 测量实际渲染高度与截断行为（scrollWidth > clientWidth、省略号生效）。
 * 用法：npm run build 之后 node scripts/summary-truncation-check.mjs
 */
const root = join(fileURLToPath(new URL('..', import.meta.url)));

const cssCascade = [
  'src/styles/message-list.css',
  'src/styles/2026/message-list.css',
  'src/styles/2026/pass-refinement.css',
  'src/styles/2026/workspace-hierarchy.css',
].map((file) => readFileSync(join(root, file), 'utf8')).join('\n');

const longBody = `${'这是一封包含超长正文摘要的测试邮件。'.repeat(120)}`;

const fixture = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${cssCascade}</style>
<style>
  body { font-family: -apple-system, 'PingFang SC', sans-serif; }
  .card-shell { width: 340px; }
</style>
</head>
<body>
  <div class="card-shell">
    <div class="message-card" style="width: 340px;">
      <div class="message-topline"><span class="sender">Alice</span><time>10:00</time></div>
      <div class="message-subject-line"><span class="subject">长摘要测试</span></div>
      <p id="preview" title="${longBody}">${longBody}</p>
    </div>
  </div>
</body>
</html>`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'summary-truncation-'));
  const fixturePath = join(fixtureDir, 'index.html');
  writeFileSync(fixturePath, fixture);

  const chromeCandidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'google-chrome',
    'chromium',
    'chrome',
  ].filter(Boolean);

  let chromePath = null;
  for (const candidate of chromeCandidates) {
    try {
      const child = spawn(candidate, ['--version'], { stdio: 'ignore' });
      const code = await new Promise((resolve) => child.once('exit', resolve));
      if (code === 0) { chromePath = candidate; break; }
    } catch {
      // Try the next candidate.
    }
  }
  if (!chromePath) {
    rmSync(fixtureDir, { recursive: true, force: true });
    throw new Error('Chrome/Chromium not found; set CHROME_PATH to run this check.');
  }

  const debugPort = 19530;
  const profileDir = mkdtempSync(join(tmpdir(), 'summary-truncation-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    `file://${fixturePath}`,
  ], { stdio: 'ignore' });

  try {
    await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);

    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const target = targets.find((entry) => entry.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('No page target');

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    const send = (method, params = {}) => {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out: ${method}`));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
      });
    };

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { result } = await send('Runtime.evaluate', {
        expression: `!!document.querySelector('#preview')`,
        returnByValue: true,
      });
      if (result.value) break;
      await sleep(150);
    }

    const { result } = await send('Runtime.evaluate', {
      expression: `(() => {
        const preview = document.querySelector('#preview');
        const rect = preview.getBoundingClientRect();
        const style = getComputedStyle(preview);
        const card = document.querySelector('.message-card');
        const cardRect = card.getBoundingClientRect();
        return {
          previewHeight: rect.height,
          previewWidth: rect.width,
          lineHeight: style.lineHeight,
          fontSize: style.fontSize,
          whiteSpace: style.whiteSpace,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
          scrollWidth: preview.scrollWidth,
          clientWidth: preview.clientWidth,
          title: preview.getAttribute('title'),
          textLength: preview.textContent.length,
          cardHeight: cardRect.height,
          summaryCount: document.querySelectorAll('.message-card p').length,
        };
      })()`,
      returnByValue: true,
    });

    const data = result.value;
    console.log('summary truncation probe:', JSON.stringify(data, null, 2));

    const failures = [];
    if (data.summaryCount !== 1) failures.push(`summaryCount=${data.summaryCount}`);
    if (data.whiteSpace !== 'nowrap') failures.push(`whiteSpace=${data.whiteSpace}`);
    if (data.overflow !== 'hidden') failures.push(`overflow=${data.overflow}`);
    if (data.textOverflow !== 'ellipsis') failures.push(`textOverflow=${data.textOverflow}`);
    if (!(data.scrollWidth > data.clientWidth)) failures.push(`not truncated (scrollWidth=${data.scrollWidth} clientWidth=${data.clientWidth})`);
    const lineHeightPx = Number.parseFloat(data.lineHeight);
    if (lineHeightPx > 0 && Math.abs(data.previewHeight - lineHeightPx) > 1) {
      failures.push(`multi-line height: previewHeight=${data.previewHeight} vs lineHeight=${lineHeightPx}`);
    }
    if (data.previewHeight > 40) failures.push(`preview too tall: ${data.previewHeight}px`);
    if (data.title !== longBody) failures.push('title does not carry the full preview text');
    if (data.textLength !== longBody.length) failures.push(`text truncated in DOM: ${data.textLength}/${longBody.length}`);
    if (data.cardHeight < 40 || data.cardHeight > 160) failures.push(`card height out of single-row range: ${data.cardHeight}`);

    ws.close();
    if (failures.length > 0) {
      throw new Error(`summary truncation contract violated: ${failures.join('; ')}`);
    }
    console.log('summary truncation: OK (one line, ellipsis, full title retained)');
  } finally {
    chrome.kill('SIGTERM');
    await sleep(500);
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
