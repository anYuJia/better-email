import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Actual pointer input and frame-by-frame computed styles. Screenshots alone
// cannot tell whether an interaction eases, snaps, or blocks its next action.
export async function runMotionQuality(cdp, api) {
  const { evalInPage, setUiViewport, waitForExpression, captureScreenshot, clickButton, url, captureDir } = api;
  const traces = [];
  const continuityChecks = [];
  if (captureDir) mkdirSync(captureDir, { recursive: true });
  const pointer = async (selector, type = 'mouseMoved', offset = {}) => {
    const point = await evalInPage(cdp, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Motion target missing: ' + ${JSON.stringify(selector)});
      const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type, ...point,
      ...(type === 'mouseMoved' ? {} : { button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }), ...offset });
  };
  const click = async (selector) => { await pointer(selector, 'mouseMoved'); await pointer(selector, 'mousePressed'); await pointer(selector, 'mouseReleased'); };
  const key = async (value) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value, windowsVirtualKeyCode: value === 'Escape' ? 27 : 9 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value, windowsVirtualKeyCode: value === 'Escape' ? 27 : 9 });
  };
  const trace = async (name, selector, action, observationMs = 380) => {
    await evalInPage(cdp, `(() => {
      window.__motionTrace = new Promise(resolve => {
        const frames = []; const start = performance.now();
        const frame = (time) => {
          const element = document.querySelector(${JSON.stringify(selector)});
          const style = element && getComputedStyle(element);
          frames.push({ time: Math.round(Math.max(0, time - start) * 100) / 100,
            present: Boolean(element && element.getBoundingClientRect().width > 0 && style.visibility !== 'hidden'),
            opacity: style?.opacity, translate: style?.translate, scale: style?.scale, transform: style?.transform,
            clipPath: style?.clipPath, replyRevealing: element?.hasAttribute('data-reply-revealing'),
            background: style?.backgroundColor, color: style?.color, left: style?.left,
            placement: element?.getAttribute('class'), inert: Boolean(element?.closest('[inert]')),
            viewportOverflow: document.documentElement.scrollWidth > window.innerWidth,
            fixedProbeLeft: document.querySelector('[data-motion-fixed-probe]')?.getBoundingClientRect().left,
            animations: element?.getAnimations().filter(a => a.playState === 'running').length ?? 0 });
          if (time - start < ${observationMs}) requestAnimationFrame(frame); else resolve(frames);
        }; requestAnimationFrame(frame);
      }); return true;
    })()`);
    await action();
    const frames = await evalInPage(cdp, 'window.__motionTrace');
    const result = { name, selector, frames };
    traces.push(result);
    if (captureDir) writeFileSync(join(captureDir, 'motion-traces.json'), JSON.stringify(traces, null, 2));
    return frames;
  };
  const assertInterpolated = (frames, properties, name) => {
    const distinct = new Set(frames.filter(f => f.present).map(f => properties.map(p => f[p]).join('|')));
    if (distinct.size < 3) throw new Error(`${name} snapped or had no observable interpolation (${distinct.size} states)`);
  };
  const assertStationary = (frames, name) => {
    if (frames.some(f => (f.scale && !['none', '1'].includes(f.scale))
      || (f.translate && !['none', '0px', '0px 0px'].includes(f.translate))
      || (f.transform && f.transform !== 'none'))) throw new Error(`${name} moved instead of using colour feedback`);
  };
  await setUiViewport(cdp, 1280, 800);
  await evalInPage(cdp, `history.replaceState({}, '', ${JSON.stringify(url)}); location.reload()`);
  await waitForExpression(cdp, "document.querySelector('.compose-button') && document.querySelectorAll('.message-card-main').length > 2");
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
  await waitForExpression(cdp, "document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)");

  // Optional recording stays entirely inside the isolated mock profile.
  const recorded = [];
  let recorder;
  let recordingBusy = false;
  if (captureDir && process.env.BETTER_EMAIL_UI_RECORD_MOTION === '1') {
    mkdirSync(join(captureDir, 'frames'), { recursive: true });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 86, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
    recorder = setInterval(async () => {
      if (recordingBusy) return;
      recordingBusy = true;
      try {
        for (const event of cdp.events.splice(0)) {
          if (event.method !== 'Page.screencastFrame') continue;
          const { data, metadata, sessionId } = event.params;
          const file = `frame-${String(recorded.length).padStart(5, '0')}.jpg`;
          writeFileSync(join(captureDir, 'frames', file), Buffer.from(data, 'base64'));
          recorded.push({ file, timestamp: metadata.timestamp });
          await cdp.send('Page.screencastFrameAck', { sessionId });
        }
      } finally { recordingBusy = false; }
    }, 12);
  }
  try {
    const hovered = await trace('primary hover', '.compose-button', () => pointer('.compose-button'));
    assertInterpolated(hovered, ['background', 'color'], 'Primary hover');
    assertStationary(hovered, 'Primary hover');
    const pressed = await trace('primary press', '.compose-button', () => pointer('.compose-button', 'mousePressed'));
    assertInterpolated(pressed, ['translate', 'scale'], 'Primary press');
    if (Math.abs(Number.parseFloat(pressed.at(-1)?.scale) - 0.98) > 0.001) throw new Error('Primary press does not settle at 98%');
    // Release away from the button: capture settle without opening a draft.
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400, button: 'left', buttons: 1 });
    const released = await trace('primary release', '.compose-button', () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 400, button: 'left', buttons: 0, clickCount: 1 }));
    assertInterpolated(released, ['translate', 'scale'], 'Primary release');
    const icon = '.reader-actions .icon-only-action:not(:disabled)';
    await pointer(icon);
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(icon)}).getAnimations().every(a => a.playState !== 'running')`);
    const iconHoverColor = await evalInPage(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(icon)})).backgroundColor`);
    const iconPress = await trace('toolbar icon press', icon, () => pointer(icon, 'mousePressed'));
    assertInterpolated(iconPress, ['background', 'color'], 'Toolbar press');
    if (iconPress.at(-1)?.background === iconHoverColor) throw new Error('Toolbar press is indistinguishable from settled hover');
    assertStationary(iconPress, 'Toolbar press');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 400, button: 'left', buttons: 0, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
    await new Promise(resolve => setTimeout(resolve, 1050));
    const coldHint = await trace('tooltip initial delay', '.global-tooltip', () => pointer(icon), 550);
    const coldFirst = coldHint.find(f => f.present);
    if (!coldFirst || coldFirst.time < 300 || coldFirst.time > 500) {
      const hintState = await evalInPage(cdp, `(() => {
        const e = document.querySelector(${JSON.stringify(icon)});
        return { firstVisible: ${JSON.stringify(coldFirst?.time ?? null)}, title: e.title,
          nativeTitle: e.getAttribute('data-native-title'), hover: e.matches(':hover'),
          active: e.matches(':active'), focused: document.hasFocus(), hidden: document.hidden,
          openOverlays: document.querySelectorAll('details[open]').length };
      })()`);
      throw new Error('Initial tooltip did not respect the 350ms reading delay: ' + JSON.stringify(hintState));
    }
    const nextIcon = await evalInPage(cdp, `(() => {
      const first = document.querySelector(${JSON.stringify(icon)});
      const candidates = [...document.querySelectorAll('.reader-actions .icon-only-action:not(:disabled)')];
      const next = candidates.find(button => button !== first && button.hasAttribute('title'));
      if (!next) throw new Error('Second toolbar tooltip target missing');
      next.dataset.motionTooltipTarget = '1'; return '[data-motion-tooltip-target="1"]';
    })()`);
    const warmHint = await trace('tooltip warm group delay and direction', '.global-tooltip', () => pointer(nextIcon), 300);
    const warmHiddenIndex = warmHint.findIndex(f => !f.present);
    const warmFirst = warmHint.slice(warmHiddenIndex + 1).find(f => f.present);
    if (!warmFirst || warmFirst.time < 75 || warmFirst.time > 240) throw new Error('Warm toolbar tooltip did not respect the 100ms delay');
    if (warmFirst.placement !== coldFirst.placement) throw new Error('Neighbouring toolbar hints changed direction');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
    if (await evalInPage(cdp, "Boolean(document.querySelector('.quick-reply-entry'))")) await click('.quick-reply-entry');
    const disabledSelector = '.quick-reply button:disabled';
    const disabled = await trace('disabled action stays still', disabledSelector, () => pointer(disabledSelector, 'mousePressed'));
    if (disabled.some(f => f.scale && !['none', '1'].includes(f.scale))) throw new Error('Disabled action has press motion');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 400, button: 'left', buttons: 0, clickCount: 1 });
    await captureScreenshot(cdp, 'motion-controls-resting');

    const menu = '.compact-dropdown.filter-menu > div';
    const entered = await trace('filter menu enter', menu, () => click('.compact-dropdown.filter-menu > summary'));
    assertInterpolated(entered, ['opacity', 'transform'], 'Filter menu enter');
    await captureScreenshot(cdp, 'motion-menu-open');
    const menuExit = await trace('filter menu exit', '[data-transient-exit]', () => key('Escape'));
    if (!menuExit.some(f => f.present && f.inert) || menuExit.at(-1)?.present) throw new Error('Menu exit did not retain an inert visual then remove it');
    assertInterpolated(menuExit, ['opacity', 'transform'], 'Filter menu exit');
    await waitForExpression(cdp, "!document.querySelector('.filter-menu[open]') && !document.querySelector('[data-transient-exit]')");

    const nextMessageSelector = await evalInPage(cdp, `(() => {
      const row = [...document.querySelectorAll('.message-card')].find(row => !row.classList.contains('is-current'));
      return '.message-card[data-message-id="' + row.dataset.messageId + '"] .message-card-main';
    })()`);
    const selected = await trace('reader identity reveal', '.reader-title-block', () => click(nextMessageSelector));
    assertInterpolated(selected, ['opacity', 'translate'], 'Reader reveal');
    // Keep rapid browsing legible; only the first selection in a burst may
    // reveal. This checks painted opacity, not just cancelled animation calls.
    let burstSamples;
    await trace('reader continuous selections stay readable', '.reader-title-block', async () => {
      burstSamples = await evalInPage(cdp, `(async () => {
        const rows = [...document.querySelectorAll('.message-card')].slice(0, 3);
        const samples = [];
        for (let i = 0; i < 7; i += 1) {
          const row = rows[i % rows.length]; row.querySelector('.message-card-main').click();
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const title = document.querySelector('.reader-title-block');
          samples.push({ id: row.dataset.messageId, opacity: title ? Number(getComputedStyle(title).opacity) : null });
          await new Promise(resolve => setTimeout(resolve, 60));
        }
        return samples;
      })()`);
      if (burstSamples.slice(1).some(sample => sample.opacity === null || sample.opacity < 0.99)) {
        throw new Error('Continuous browsing repeatedly faded the reader: ' + JSON.stringify(burstSamples));
      }
    }, 1050);
    continuityChecks.push({ name: 'rapid reader identities do not repeatedly dim', samples: burstSamples });
    const context = await trace('context menu enter', '.context-menu', async () => {
      await pointer(nextMessageSelector, 'mousePressed', { button: 'right', buttons: 2 });
      await pointer(nextMessageSelector, 'mouseReleased', { button: 'right', buttons: 0 });
    });
    assertInterpolated(context, ['opacity', 'transform'], 'Context menu enter');
    await pointer('.context-menu .context-menu-branch > button[aria-haspopup="menu"]');
    await waitForExpression(cdp, "document.querySelector('.context-menu .context-menu-branch.is-pointer-open > .context-submenu')");
    const flyoutBounds = await evalInPage(cdp, "(() => { const r = document.querySelector('.context-menu .context-menu-branch.is-pointer-open > .context-submenu').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()");
    await captureScreenshot(cdp, 'motion-context-flyout');
    const contextExit = await trace('context menu and flyout exit', '[data-transient-exit]', async () => {
      await key('Escape');
      const copies = await evalInPage(cdp, "[...document.querySelectorAll('[data-transient-exit]')].map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, independent: e.parentElement === document.body, inert: e.inert }; })");
      if (!copies.some(r => r.independent && r.inert && Math.abs(r.x - flyoutBounds.x) < 6 && Math.abs(r.y - flyoutBounds.y) < 6
        && r.width >= flyoutBounds.width * 0.98 && r.height >= flyoutBounds.height * 0.98)) throw new Error('Exiting flyout moved or remained inside its parent clipping context');
    });
    if (!contextExit.some(f => f.present && f.inert) || contextExit.at(-1)?.present) throw new Error('Context menu exit presentation is missing or retained');
    const composerEnter = await trace('composer enter', '.composer', () => click('.compose-button'), 1000);
    assertInterpolated(composerEnter, ['opacity', 'translate'], 'Composer enter');
    await waitForExpression(cdp, "document.querySelector('.composer') && document.querySelector('.composer [aria-label=\"关闭写信窗口\"]')");
    const morePanel = '.composer-advanced-popover';
    const moreEnter = await trace('composer more enter', morePanel, () => click('.composer-tool-more'));
    assertInterpolated(moreEnter, ['opacity', 'translate'], 'Composer more enter');
    const moreExit = await trace('composer more exit', morePanel, async () => {
      await key('Escape');
      if (!await evalInPage(cdp, "document.activeElement === document.querySelector('.composer-tool-more')")) throw new Error('More menu did not restore focus immediately');
    });
    if (!moreExit.some(f => f.present && f.inert) || moreExit.at(-1)?.present) throw new Error('More menu exit remained interactive or disappeared immediately');
    assertInterpolated(moreExit, ['opacity', 'translate'], 'Composer more exit');
    await click('.composer-tool-more');
    await waitForExpression(cdp, "document.querySelector('.composer-advanced-popover')?.getAnimations().every(a => a.playState !== 'running')");
    const moreReopen = await trace('composer more interrupted exit reopen', morePanel, async () => {
      await key('Escape');
      await new Promise(resolve => setTimeout(resolve, 40));
      const continuity = await evalInPage(cdp, `(() => {
        const panel = document.querySelector('.composer-advanced-popover');
        const before = Number(getComputedStyle(panel).opacity);
        document.querySelector('.composer-tool-more').click();
        return new Promise(resolve => requestAnimationFrame(() => resolve({
          before, after: Number(getComputedStyle(panel).opacity), same: panel === document.querySelector('.composer-advanced-popover'), inert: panel.inert,
        })));
      })()`);
      if (!continuity.same || continuity.inert || Math.abs(continuity.after - continuity.before) > 0.25) throw new Error('More reopen jumped or lost its interactive DOM: ' + JSON.stringify(continuity));
      continuityChecks.push({ name: 'composer more reopens from its painted frame', ...continuity });
    });
    if (!moreReopen.at(-1)?.present || moreReopen.at(-1)?.opacity !== '1') throw new Error('More reopen failed to settle');
    await key('Escape');
    await waitForExpression(cdp, "!document.querySelector('.composer-advanced-popover')");
    const openSchedule = async () => {
      await click('.composer-send-menu-trigger');
      await clickButton(cdp, '定时发送…', "document.querySelector('.composer-send-menu')");
    };
    const scheduleEnter = await trace('composer schedule enter', '.composer-schedule-picker-popover', openSchedule);
    assertInterpolated(scheduleEnter, ['opacity', 'translate'], 'Schedule enter');
    const scheduleExit = await trace('composer schedule exit', '.composer-schedule-picker-popover', async () => {
      await key('Escape');
      if (!await evalInPage(cdp, "document.activeElement === document.querySelector('.composer-send-menu-trigger')")) throw new Error('Schedule did not restore focus immediately');
    });
    if (!scheduleExit.some(f => f.present && f.inert) || scheduleExit.at(-1)?.present) throw new Error('Schedule exit remained interactive or disappeared immediately');
    assertInterpolated(scheduleExit, ['opacity', 'translate'], 'Schedule exit');
    // Browser-owned selection and undo cannot be proved in jsdom. Use real
    // editing input, then retain the exact DOM and range across a full hide.
    await click('.composer-richtext-body');
    await cdp.send('Input.insertText', { text: Array.from({ length: 36 }, (_, i) => `连续编辑测试 ${i + 1}：恢复后继续原位置。`).join('\n') });
    await evalInPage(cdp, `(() => {
      const editor = document.querySelector('.composer-richtext-body');
      const range = document.createRange(); range.setStart(editor.firstChild, 5); range.collapse(true);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      editor.scrollTop = 100;
      window.__editorContinuity = { editor, node: range.startContainer, offset: range.startOffset, scroll: editor.scrollTop, text: editor.textContent };
    })()`);
    await click('.composer [aria-label="收起写信"]');
    await waitForExpression(cdp, "document.querySelector('.composer-backdrop')?.hidden && document.querySelector('.composer-backdrop')?.inert");
    await click('[aria-label="展开写信窗口"]');
    await waitForExpression(cdp, "document.activeElement === document.querySelector('.composer-richtext-body')");
    const restored = await evalInPage(cdp, `(() => {
      const before = window.__editorContinuity; const editor = document.querySelector('.composer-richtext-body'); const selection = window.getSelection();
      return { sameEditor: before.editor === editor, sameText: editor.textContent === before.text,
        sameCaret: selection.anchorNode === before.node && selection.anchorOffset === before.offset,
        sameScroll: editor.scrollTop === before.scroll, interactive: !editor.closest('[inert]') };
    })()`);
    if (Object.values(restored).some(value => !value)) throw new Error('Composer restore lost edit context: ' + JSON.stringify(restored));
    continuityChecks.push({ name: 'composer preserves editor, caret, scroll and text', ...restored });
    const undoModifiers = process.platform === 'darwin' ? 4 : 2;
    // CDP needs the macOS editing command as well as the key chord; the
    // browser then consumes its real native undo stack.
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: undoModifiers, commands: ['undo'] });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: undoModifiers });
    await waitForExpression(cdp, "document.querySelector('.composer-richtext-body').textContent !== window.__editorContinuity.text");
    continuityChecks.push({ name: 'native undo survives composer minimize/restore', passed: true });
    const reversed = await trace('composer interrupted minimize restore', '.composer', async () => {
      await click('.composer [aria-label="收起写信"]');
      await new Promise(resolve => setTimeout(resolve, 60));
      const result = await evalInPage(cdp, `(() => {
        const panel = document.querySelector('.composer'); const before = Number(getComputedStyle(panel).opacity);
        document.querySelector('[aria-label="展开写信窗口"]').click();
        return new Promise(resolve => requestAnimationFrame(() => resolve({ before, after: Number(getComputedStyle(panel).opacity) })));
      })()`);
      if (Math.abs(result.after - result.before) > 0.2) throw new Error('Composer reversal jumped to an endpoint: ' + JSON.stringify(result));
    });
    if (!reversed.at(-1)?.present || reversed.at(-1)?.opacity !== '1') throw new Error('Interrupted composer did not return to rest');
    await evalInPage(cdp, `(() => {
      const editor = document.querySelector('.composer-richtext-body'); editor.focus();
      document.execCommand('insertText', false, '即时收起保留最后输入');
      // Both happen in one task, before the scheduled input-sync frame.
      document.querySelector('.composer [aria-label="收起写信"]').click();
    })()`);
    await waitForExpression(cdp, "document.querySelector('.composer-backdrop')?.hidden");
    await click('[aria-label="展开写信窗口"]');
    await waitForExpression(cdp, "document.querySelector('.composer-richtext-body')?.textContent.includes('即时收起保留最后输入')");
    continuityChecks.push({ name: 'same-task input then minimize retains the final text', passed: true });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: undoModifiers, commands: ['undo'] });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, modifiers: undoModifiers });
    await waitForExpression(cdp, "!document.querySelector('.composer-richtext-body')?.textContent.trim()");
    await captureScreenshot(cdp, 'motion-composer-open');
    const exiting = await trace('composer exit', '.composer', () => click('.composer [aria-label="关闭写信窗口"]'));
    if (!exiting.some(f => f.present && f.inert) || exiting.at(-1)?.present) throw new Error('Composer exit did not retain an inert outgoing surface then remove it');
    const settingsEnter = await trace('settings enter', '.settings-modal', () => click('.sidebar-footer .settings-button'), 800);
    assertInterpolated(settingsEnter, ['opacity', 'transform'], 'Settings enter');
    await waitForExpression(cdp, "document.querySelector('.settings-page')");
    const section = await trace('settings page switch', '.settings-page', () => clickButton(cdp, '关于', "document.querySelector('.settings-modal')"));
    assertInterpolated(section, ['opacity', 'transform'], 'Settings page switch');
    await captureScreenshot(cdp, 'motion-settings-open');
    await click('[aria-label="关闭设置"]');
    await waitForExpression(cdp, "!document.querySelector('.settings-modal')");

    // Reopening continues from the visible exit frame, including its opacity;
    // merely staying mounted after the old exit finishes is not sufficient.
    await click('.compact-dropdown.filter-menu > summary');
    await waitForExpression(cdp, "document.querySelector('.filter-menu[open][data-menu-positioned=\"true\"]')");
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(menu)}).getAnimations().every(a => a.playState !== 'running')`);
    const reopened = await trace('rapid menu reopen', menu, async () => {
      const result = await evalInPage(cdp, `new Promise(resolve => {
        const openBefore = document.querySelector('.filter-menu').open;
        document.querySelector('.compact-dropdown.filter-menu > summary').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const ghostImmediately = Boolean(document.querySelector('[data-transient-exit]'));
        setTimeout(() => {
        const outgoing = document.querySelector('[data-transient-exit]');
        if (!outgoing) { resolve({ missing: true, openBefore, ghostImmediately, openAfter: document.querySelector('.filter-menu').open }); return; }
        const before = Number(getComputedStyle(outgoing).opacity);
        document.querySelector('.compact-dropdown.filter-menu > summary').click();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const panel = document.querySelector(${JSON.stringify(menu)});
          resolve({ before, after: Number(getComputedStyle(panel).opacity) });
        }));
      }, 40); })`);
      if (result.missing || result.after + 0.05 < result.before) throw new Error('Menu reopen flashed darker than its interrupted exit: ' + JSON.stringify(result));
      continuityChecks.push({ name: 'menu reopen continues from interrupted exit', ...result });
    });
    if (!reopened.at(-1)?.present || reopened.at(-1)?.opacity !== '1') throw new Error('Rapid menu reopen was removed by a stale exit');
    await key('Escape');
    await waitForExpression(cdp, "!document.querySelector('[data-transient-exit]')");

    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await trace('reduced motion press', '.compose-button', () => pointer('.compose-button', 'mousePressed'));
    if (reduced.some(f => f.animations > 0 || (f.scale && !['none', '1'].includes(f.scale)) || (f.translate && !['none', '0px', '0px 0px'].includes(f.translate)))) throw new Error('Reduced motion still moves the primary button');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 400, button: 'left', buttons: 0, clickCount: 1 });
    await click('.compact-dropdown.filter-menu > summary');
    await key('Escape');
    const reducedGhosts = await evalInPage(cdp, "document.querySelectorAll('[data-transient-exit]').length");
    if (reducedGhosts) throw new Error('Reduced motion retained menu exit ghosts');
    await click('.compose-button');
    await waitForExpression(cdp, "document.querySelector('.composer')");
    for (const [name, selector, open] of [
      ['more', '.composer-advanced-popover', () => click('.composer-tool-more')],
      ['schedule', '.composer-schedule-picker-popover', openSchedule],
    ]) {
      const frames = await trace('composer ' + name + ' reduced motion', selector, open);
      if (frames.some(f => f.present && (f.opacity !== '1' || f.animations > 0 || (f.translate && !['none', '0px', '0px 0px'].includes(f.translate))))) throw new Error(name + ' still animates with reduced motion');
      await key('Escape');
      if (await evalInPage(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)) throw new Error(name + ' retains outgoing DOM with reduced motion');
    }
    await click('.composer [aria-label="关闭写信窗口"]');
    await waitForExpression(cdp, "!document.querySelector('.composer')");
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    await setUiViewport(cdp, 390, 844);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await waitForExpression(cdp, "document.querySelector('.mobile-bottom-compose')");
    const touchPoint = await evalInPage(cdp, "(() => { const r = document.querySelector('.mobile-bottom-compose').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
    // Raw dispatchTouchEvent sends DOM events without Chrome's gesture press
    // recognition (:active). Use its complete native touch gesture path.
    const touch = await trace('mobile touch press and release', '.mobile-bottom-compose', () => cdp.send('Input.synthesizeTapGesture', {
      ...touchPoint, duration: 200, tapCount: 1, gestureSourceType: 'touch',
    }), 700);
    assertInterpolated(touch, ['scale'], 'Mobile touch press');
    const touchMinimum = Math.min(...touch.map(f => Number.parseFloat(f.scale)).filter(Number.isFinite));
    if (Math.abs(touchMinimum - 0.98) > 0.001 || !['1', 'none'].includes(touch.at(-1)?.scale)) throw new Error('Touch press did not reach 98% and return to rest');
    if (touch.at(-1)?.translate && !['none', '0px', '0px 0px'].includes(touch.at(-1).translate)) throw new Error('Touch leaves a sticky hover lift');
    await waitForExpression(cdp, "document.querySelector('.composer')");
    for (const [name, selector, open] of [
      ['more', '.composer-advanced-popover', () => click('.composer-tool-more')],
      ['schedule', '.composer-schedule-picker-popover', openSchedule],
    ]) {
      const entered = await trace('mobile composer ' + name + ' enter', selector, open);
      assertInterpolated(entered, ['opacity', 'translate'], 'Mobile ' + name + ' enter');
      const bounds = await evalInPage(cdp, `(() => {
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight };
      })()`);
      if (bounds.left < 0 || bounds.top < 0 || bounds.right > bounds.width || bounds.bottom > bounds.height) throw new Error('Mobile ' + name + ' escaped the viewport: ' + JSON.stringify(bounds));
      await captureScreenshot(cdp, 'motion-mobile-composer-' + name);
      const exited = await trace('mobile composer ' + name + ' exit', selector, () => key('Escape'));
      if (!exited.some(f => f.present && f.inert) || exited.at(-1)?.present) throw new Error('Mobile ' + name + ' exit lifecycle failed');
      assertInterpolated(exited, ['opacity', 'translate'], 'Mobile ' + name + ' exit');
    }
    await captureScreenshot(cdp, 'motion-mobile-composer');
    await click('.composer [aria-label="关闭写信窗口"]');
    await waitForExpression(cdp, "!document.querySelector('.composer')");
    await captureScreenshot(cdp, 'motion-mobile-resting');
    const mobileMail = '.mobile-screen-layer--mail';
    const mobileReader = await trace('mobile reader push keeps inbox stationary', mobileMail, () => click('.message-card-main'));
    if (mobileReader.some(f => f.present && (f.animations > 0 || (f.translate && !['none', '0px', '0px 0px'].includes(f.translate))))) throw new Error('Mobile inbox moves under pushed reader');
    await waitForExpression(cdp, "document.querySelector('.quick-reply-entry')");
    const replyReveal = await trace('mobile quick reply local reveal', '.quick-reply', async () => {
      await click('.quick-reply-entry');
      const focus = await evalInPage(cdp, "document.activeElement === document.querySelector('.quick-reply textarea')");
      if (!focus) throw new Error('Quick reply waits for its animation before accepting input');
      await cdp.send('Input.insertText', { text: '动效期间继续输入' });
    });
    assertInterpolated(replyReveal, ['clipPath'], 'Quick reply reveal');
    const replyContinuity = await evalInPage(cdp, `(() => ({
      text: document.querySelector('.quick-reply textarea').value,
      focused: document.activeElement === document.querySelector('.quick-reply textarea'),
      settled: !document.querySelector('.quick-reply').hasAttribute('data-reply-revealing'),
      bodyAnimations: document.querySelector('.reader').getAnimations().filter(a => a.playState === 'running').length,
    }))()`);
    if (replyContinuity.text !== '动效期间继续输入' || !replyContinuity.focused || !replyContinuity.settled || replyContinuity.bodyAnimations) throw new Error('Quick reply reveal interrupted editing or moved the reader: ' + JSON.stringify(replyContinuity));
    continuityChecks.push({ name: 'quick reply accepts input during local reveal', ...replyContinuity });
    await captureScreenshot(cdp, 'motion-mobile-quick-reply');
    const mobileReturn = await trace('mobile reader pop reveals stationary inbox', mobileMail, () => click('[data-narrow-reader-back]'));
    if (mobileReturn.some(f => f.present && (f.animations > 0 || (f.translate && !['none', '0px', '0px 0px'].includes(f.translate))))) throw new Error('Mobile inbox replays entry on return');
    if (!mobileReturn.at(-1)?.present) throw new Error('Mobile inbox did not return');

    await click('[aria-label="打开邮箱导航"]');
    await clickButton(cdp, '设置', "document.querySelector('.mobile-mailbox-footer')");
    await waitForExpression(cdp, "document.querySelector('.mobile-settings-root') && !document.querySelector('.mobile-settings-root').closest('[inert]')");
    const settingsPush = await trace('mobile settings detail push', '.settings-modal', () => click('[aria-label="打开账号设置"]'), 550);
    assertInterpolated(settingsPush, ['left'], 'Mobile settings detail push');
    if (!settingsPush.some(f => Number.parseFloat(f.left) > 1)) throw new Error('Settings detail did not enter from the right');
    await click('.settings-header-account-switcher .account-switcher-trigger');
    await click('.account-switcher-menu [data-context-item^="account-scope-"]:not([data-context-item="account-scope-all"])');
    await waitForExpression(cdp, "document.querySelector('.settings-page .settings-destination-row')");
    const nestedPush = await trace('mobile settings nested forward', '.settings-page', async () => {
      await clickButton(cdp, '服务器与协议', "document.querySelector('.settings-page')");
      await evalInPage(cdp, `(() => {
        const probe = document.createElement('div'); probe.dataset.motionFixedProbe = '1';
        probe.style.cssText = 'position:fixed;left:18px;top:200px;width:10px;height:10px;pointer-events:none';
        document.querySelector('.settings-page').append(probe);
      })()`);
    });
    assertInterpolated(nestedPush, ['left'], 'Mobile settings nested forward');
    if (!nestedPush.some(f => Number.parseFloat(f.left) > 1)) throw new Error('Nested settings forward lost its direction');
    if (nestedPush.some(f => f.fixedProbeLeft !== undefined && Math.abs(f.fixedProbeLeft - 18) > 0.1)) throw new Error('Settings motion moved a fixed descendant');
    await captureScreenshot(cdp, 'motion-mobile-settings-detail');
    const nestedPop = await trace('mobile settings nested backward', '.settings-page', () => click('.settings-mobile-back'));
    assertInterpolated(nestedPop, ['left'], 'Mobile settings nested backward');
    if (!nestedPop.some(f => Number.parseFloat(f.left) < -1)) throw new Error('Nested settings return lost its opposite direction');
    const settingsPop = await trace('mobile settings detail pop', '.settings-modal', () => click('.settings-mobile-back'));
    assertInterpolated(settingsPop, ['left'], 'Mobile settings detail pop');
    if (settingsPop.at(-1)?.present) throw new Error('Settings detail remained after returning to its root');
    if ([...settingsPush, ...nestedPush, ...nestedPop, ...settingsPop].some(f => f.viewportOverflow)) throw new Error('Settings motion created viewport horizontal overflow');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const settingsReduced = await trace('mobile settings reduced motion', '.settings-modal', () => click('[aria-label="打开账号设置"]'));
    if (settingsReduced.some(f => f.present && (f.animations > 0 || (f.left !== 'auto' && Number.parseFloat(f.left) !== 0)))) throw new Error('Reduced motion still shifts mobile settings');
    await click('.settings-mobile-back');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  } finally {
    clearInterval(recorder);
    await cdp.send('Page.stopScreencast');
    while (recordingBusy) await new Promise(resolve => setTimeout(resolve, 10));
    if (recorded.length) {
      const concat = recorded.map((frame, i) => `file 'frames/${frame.file}'\nduration ${Math.max(0.016, (recorded[i + 1]?.timestamp ?? frame.timestamp + 0.5) - frame.timestamp).toFixed(6)}`).join('\n');
      writeFileSync(join(captureDir, 'motion-recording.txt'), concat + `\nfile 'frames/${recorded.at(-1).file}'\n`);
    }
  }
  const report = { status: 'ok', kind: 'mock-browser-motion', traces, continuityChecks, recordedFrames: recorded.length,
    limitations: ['Chromium mock, not native WebKit', 'Frame sampling proves interpolation and lifecycle, not production device frame-rate guarantees'] };
  if (captureDir) writeFileSync(join(captureDir, 'motion-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: 'ok', motionCases: traces.map(t => t.name), continuityChecks, recordedFrames: recorded.length }, null, 2));
}
