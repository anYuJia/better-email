// Shared page-side workload. No product instrumentation or real account access.
// The host provides real mouse events; selection, scrolling and editor commands
// below are explicitly scripted so results remain reproducible.
export async function runInteractionPerformance(config) {
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label, limit = 15000) => {
    const started = performance.now();
    while (!predicate()) {
      if (performance.now() - started > limit) throw new Error(`Timed out: ${label}`);
      await delay(25);
    }
  };
  const stats = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
    return { count: values.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sorted.at(-1) ?? 0 };
  };
  const progress = name => window.__perfHostLog?.(name);
  const scenarios = [];
  const sample = async (name, action) => {
    progress(name);
    const intervals = [];
    const longTasks = [];
    let last = await frame();
    let raf;
    const tick = time => { intervals.push(time - last); last = time; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const supportsLongTasks = PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false;
    const observer = supportsLongTasks ? new PerformanceObserver(list => {
      longTasks.push(...list.getEntries().map(entry => entry.duration));
    }) : null;
    observer?.observe({ type: 'longtask' });
    const start = performance.now();
    const details = await action();
    await frame();
    cancelAnimationFrame(raf);
    observer?.disconnect();
    const result = { name, durationMs: performance.now() - start,
      rafIntervals: { ...stats(intervals), over25Ms: intervals.filter(n => n > 25).length,
        over50Ms: intervals.filter(n => n > 50).length, rawMs: intervals },
      longTasks: supportsLongTasks ? stats(longTasks) : { supported: false }, ...details };
    scenarios.push(result);
    return result;
  };
  await wait(() => document.querySelector('.compose-button') && document.querySelectorAll('.message-card-main').length > 2, 'initial mock mailbox');
  const state = await import('/src/mockTauri/state.ts');
  const source = state.messages.find(message => message.account_id === 1 && message.folder_role === 'inbox');
  if (!source) throw new Error('Missing mock source');
  const longBody = Array.from({ length: 1400 }, (_, i) => `第 ${i + 1} 段：长邮件滚动采样，内容用于隔离性能测试。 The message content remains readable while scrolling.`).join('\n\n');
  const fixtures = Array.from({ length: config.messageCount }, (_, i) => ({ ...source,
    id: 900000 + i, subject: `Performance fixture ${i}`, snippet: 'Isolated local performance fixture',
    sender_name: 'Performance Fixture', sender_email: 'performance@example.invalid',
    received_at: new Date(Date.UTC(2030, 0, 1) - i * 60000).toISOString(),
    body: i === 0 ? longBody : `Fixture ${i}: 本地性能测试。`, sanitized_html: '', security_warnings: [],
    is_read: true, is_starred: false, has_attachments: false, labels: [], attachment_count: 0,
    remote_uid: 0, message_id_header: `<performance-${i}@example.invalid>`,
    in_reply_to_header: '', references_header: '',
  }));
  state.messages.unshift(...fixtures);
  const refresh = () => document.querySelector('[aria-label="刷新邮件"]')?.click();
  refresh();
  const row = id => document.querySelector(`.message-card[data-message-id="${id}"] .message-card-main`);
  await wait(() => row(900000), 'fixture refresh');
  await wait(() => !document.querySelector('.titlebar-refresh[aria-busy="true"]'), 'initial refresh completion');
  await delay(500);
  const readerTitle = () => document.querySelector('.reader-title-block')?.textContent ?? '';
  const select = async index => {
    const button = row(900000 + index);
    if (!button) throw new Error(`Missing visible fixture ${index}`);
    button.click();
    const started = performance.now();
    while (!readerTitle().includes(`Performance fixture ${index}`)) {
      if (performance.now() - started > 5000) throw new Error(`Reader ${index} not ready`);
      await frame();
    }
  };
  const openComposer = async () => {
    if (!document.querySelector('.composer-richtext-body')) document.querySelector('.compose-button').click();
    await wait(() => document.querySelector('.composer-richtext-body'), 'composer editor');
    await delay(250);
  };
  const closeComposer = async () => {
    document.querySelector('[aria-label="关闭写信窗口"]')?.click();
    await wait(() => !document.querySelector('.composer') || document.querySelector('.composer-close-dialog'), 'composer close or draft prompt');
    document.querySelector('.composer-close-dialog .dialog-button-danger-secondary')?.click();
    await wait(() => !document.querySelector('.composer'), 'composer close');
  };
  // Warm lazy surfaces before steady-state measurements. Cold startup is not
  // mixed into individual interactions and is not claimed as a startup metric.
  await openComposer();
  await closeComposer();
  await sample('idle-callback-baseline', async () => {
    for (let i = 0; i < 120; i += 1) await frame();
    return { steps: 120 };
  });
  for (let repeat = 0; repeat < config.repeats; repeat += 1) {
    await openComposer();
    await sample(`drag-window-${repeat + 1}`, async () => {
      const panel = document.querySelector('.composer');
      const header = document.querySelector('.composer-editor-header');
      const rect = header.getBoundingClientRect();
      const start = panel.getBoundingClientRect();
      const x = rect.left + 100; const y = rect.top + rect.height / 2;
      const direction = start.left > 120 ? -1 : 1;
      let pointerMoves = 0; let styleMutations = 0;
      const count = () => { pointerMoves += 1; };
      panel.addEventListener('pointermove', count);
      const mutationObserver = new MutationObserver(records => { styleMutations += records.length; });
      mutationObserver.observe(panel, { attributes: true, attributeFilter: ['style'] });
      await window.__perfHostAction({ type: 'down', x, y });
      for (let i = 1; i <= 60; i += 1) {
        await window.__perfHostAction({ type: 'drag', x: x + direction * i * 1.6, y: y + Math.sin(i / 10) * 24 });
        await frame();
      }
      await window.__perfHostAction({ type: 'up', x: x + direction * 96, y: y + Math.sin(6) * 24 });
      await frame();
      mutationObserver.disconnect();
      panel.removeEventListener('pointermove', count);
      const end = panel.getBoundingClientRect();
      const displacement = { x: end.x - start.x, y: end.y - start.y };
      if (pointerMoves < 30 || Math.abs(displacement.x) < 20) throw new Error(`Native drag did not reach product: ${JSON.stringify({pointerMoves, displacement})}`);
      return { injectedMoves: 60, receivedPointerMoves: pointerMoves, panelStyleMutations: styleMutations, displacement };
    });
    await closeComposer();
    await sample(`rapid-message-selection-${repeat + 1}`, async () => {
      const ready = [];
      for (let i = 0; i < 24; i += 1) {
        const index = 1 + i % 4;
        const start = performance.now();
        await select(index);
        await frame();
        ready.push(performance.now() - start);
      }
      return { switches: ready.length, selectionToTitleAndRaf: stats(ready), finalTitle: readerTitle() };
    });
    await select(0);
    await delay(250);
    await sample(`long-message-scroll-${repeat + 1}`, async () => {
      const reader = document.querySelector('.reader-panel');
      const extent = reader.scrollHeight - reader.clientHeight;
      if (extent < 3000) throw new Error(`Long fixture did not produce scrollable reader: ${extent}`);
      for (let i = 0; i < 120; i += 1) {
        reader.scrollTop = i * Math.min(80, extent / 120);
        await frame();
      }
      return { steps: 120, bodyCharacters: longBody.length, scrollExtentPx: extent, finalScrollTop: reader.scrollTop };
    });
    for (const backgroundUpdates of [false, true]) {
      await openComposer();
      await sample(`typing-${backgroundUpdates ? 'with-mock-refresh' : 'baseline'}-${repeat + 1}`, async () => {
        const editor = document.querySelector('.composer-richtext-body');
        editor.focus();
        const selection = getSelection(); const range = document.createRange();
        range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
        document.execCommand('delete');
        const inserted = [];
        let refreshes = 0;
        const latestSyncRunId = state.syncRuns[0]?.id ?? 0;
        const text = '这是输入期间邮件更新的隔离测试。Typing remains continuous while mock messages refresh. '.repeat(2);
        for (let i = 0; i < text.length; i += 1) {
          const start = performance.now();
          document.execCommand('insertText', false, text[i]);
          if (backgroundUpdates && i % 15 === 0) {
            fixtures[1].snippet = `Background mock header update ${i}`;
            fixtures[1].is_starred = !fixtures[1].is_starred;
            refresh(); refreshes += 1;
          }
          await frame();
          inserted.push(performance.now() - start);
        }
        if (editor.textContent !== text) throw new Error(`Typed content mismatch: ${editor.textContent?.length}/${text.length}`);
        return { characters: text.length, mockRefreshRequests: refreshes,
          completedMockSyncRuns: (state.syncRuns[0]?.id ?? 0) - latestSyncRunId,
          inputCommandToNextRaf: stats(inserted), textPreserved: true };
      });
      // Closing nonempty drafts follows the existing local autosave path. This
      // test never invokes Send; empty the editor to avoid confirmation dialogs.
      const editor = document.querySelector('.composer-richtext-body');
      editor.focus();
      const selection = getSelection(); const range = document.createRange();
      range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
      document.execCommand('delete');
      editor.blur();
      await closeComposer();
      await delay(250);
    }
  }
  return { schemaVersion: 1, engine: config.engine, userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, visibility: document.visibilityState,
    mockMessages: config.messageCount, repeats: config.repeats,
    conditions: ['Vite development build; lazy surfaces warmed', 'Local mock bridge; no Tauri IPC, SQLite or providers',
      'Native host mouse events for drag; scripted DOM clicks, scrollTop and execCommand for remaining scenarios',
      'rAF intervals and callback-ready latency are scheduling proxies, not compositor presentation time or physical input latency',
      'No screenshot/video recording during sampling; no CPU throttling'], scenarios };
}
