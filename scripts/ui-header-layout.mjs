import assert from 'node:assert/strict';

export function assertContained(parent, child, name, tolerance = 1) {
  assert.ok(child.width > 0 && child.height > 0, `${name} has no visible area`);
  assert.ok(child.left >= parent.left - tolerance && child.right <= parent.right + tolerance
    && child.top >= parent.top - tolerance && child.bottom <= parent.bottom + tolerance,
  `${name} is clipped: ${JSON.stringify({ parent, child })}`);
}

export function assertHeaderLayout(snapshot) {
  assert.ok(snapshot.hint.hidden, `Search accessibility hint is visible: ${JSON.stringify(snapshot.hint)}`);
  assert.ok(snapshot.input.width >= 100, `Search input collapsed: ${snapshot.input.width}px`);
  const fields = snapshot.fields.filter((field) => field.rect.width > 0);
  for (const field of fields) assertContained(snapshot.search, field.rect, field.name);
  for (let index = 0; index < fields.length; index += 1) {
    for (let next = index + 1; next < fields.length; next += 1) {
      const a = fields[index].rect;
      const b = fields[next].rect;
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      assert.ok(overlap <= 1, `Search fields overlap: ${fields[index].name}, ${fields[next].name}`);
    }
  }
  for (const control of snapshot.controls) {
    assertContained(snapshot.header, control.rect, control.name);
    assertContained(snapshot.pane, control.rect, control.name);
    assert.ok(control.hit, `${control.name} is covered by another element`);
    assert.ok(control.scrollWidth <= control.clientWidth + 1, `${control.name} text is truncated`);
  }
  assert.ok(snapshot.documentWidth <= snapshot.viewportWidth + 1, 'Workspace overflows the viewport');
}

function readHeaderLayout() {
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  };
  const search = document.querySelector('.app-titlebar .global-search-box');
  const input = search?.querySelector('input');
  const hint = input && document.getElementById(input.getAttribute('aria-describedby'));
  const header = document.querySelector('.list-control-strip');
  if (!search || !input || !hint || !header) throw new Error('Required initial header elements missing');
  const hintStyle = getComputedStyle(hint);
  const hintRect = rect(hint);
  const selectors = ['.list-control-tabs > button', '.filter-menu > summary', '.sort-menu > summary'];
  return {
    search: rect(search),
    input: rect(input),
    hint: { ...hintRect, position: hintStyle.position, hidden: hintStyle.position === 'absolute'
      && hintRect.width <= 1 && hintRect.height <= 1 && hintStyle.overflow === 'hidden' },
    header: rect(header),
    pane: rect(header.parentElement),
    fields: [...search.children].filter((element) => element !== hint
      && !element.classList.contains('search-suggestion-panel'))
      .map((element) => ({ name: element.tagName + '.' + element.className, rect: rect(element) })),
    controls: selectors.flatMap((selector) => [...header.querySelectorAll(selector)]).map((element) => {
      const box = rect(element);
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { name: element.getAttribute('aria-label') || element.textContent.trim(), rect: box,
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, hit: element === hit || element.contains(hit) };
    }),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  };
}

export async function testInitialHeaderLayout({ cdp, evaluate, wait, viewport, screenshot }) {
  await wait(cdp, "document.querySelector('.sort-menu > summary') && document.querySelector('.global-search-box input')");
  await evaluate(cdp, 'document.fonts.ready');
  const initial = await evaluate(cdp, `(${readHeaderLayout.toString()})()`);
  assertHeaderLayout(initial);
  await screenshot(cdp, 'header-first-boot-before-composer');
  const saved = await evaluate(cdp, `(() => {
    const root = document.documentElement;
    const tokens = ['--ui-font-size-aux', '--ui-font-size-meta', '--ui-font-size-secondary', '--ui-font-size-body', '--ui-font-size-section', '--ui-font-size-title'];
    return { rootStyle: root.getAttribute('style'), theme: root.getAttribute('data-theme'),
      shellStyle: document.querySelector('.app-shell').getAttribute('style'),
      tokens: Object.fromEntries(tokens.map((name) => [name, parseFloat(getComputedStyle(root).getPropertyValue(name))])) };
  })()`);
  const setQuery = async (value) => {
    await evaluate(cdp, `(() => {
      const input = document.querySelector('.global-search-box input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
  };
  try {
    for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768]]) {
      await viewport(cdp, width, height);
      await wait(cdp, '!document.querySelector(".app-shell.is-mobile-app")');
      for (const listWidth of [320, 388]) {
        for (const scale of [1, 1.25, 1.5]) {
          for (const theme of ['light', 'dark']) {
            await evaluate(cdp, `(() => {
              const root = document.documentElement;
              root.dataset.theme = ${JSON.stringify(theme)};
              const tokens = ${JSON.stringify(saved.tokens)};
              for (const [name, size] of Object.entries(tokens)) root.style.setProperty(name, size * ${scale} + 'px');
              document.querySelector('.app-shell').style.setProperty('--app-list-width', '${listWidth}px');
              return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            })()`);
            for (const query of ['', '搜索中文长文字与 very-long-English-query '.repeat(8)]) {
              await setQuery(query);
              const snapshot = await evaluate(cdp, `(${readHeaderLayout.toString()})()`);
              try { assertHeaderLayout(snapshot); } catch (error) {
                throw new Error(`Header ${width}x${height}, list=${listWidth}, text=${scale}, ${theme}: ${error.message}`);
              }
            }
            if (listWidth === 320 && scale === 1.5) {
              await screenshot(cdp, `header-${width}-${theme}-150pct-320`);
              await evaluate(cdp, "document.querySelector('.sort-menu > summary').click()");
              await wait(cdp, "document.querySelector('.sort-menu').open && document.querySelector('.sort-menu [role=menu]').getBoundingClientRect().height > 0");
              await evaluate(cdp, `(() => {
                const panel = document.querySelector('.sort-menu [role=menu]');
                const box = panel.getBoundingClientRect();
                if (box.left < 0 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) throw new Error('Sort menu outside viewport');
                for (const button of panel.querySelectorAll('button')) {
                  const rect = button.getBoundingClientRect();
                  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                  if (hit !== button && !button.contains(hit)) throw new Error('Sort option clipped by pane');
                }
                document.querySelector('.sort-menu > summary').click();
              })()`);
              await wait(cdp, "!document.querySelector('.sort-menu').open");
            }
          }
        }
      }
    }
  } finally {
    await setQuery('');
    await evaluate(cdp, `(() => {
      const saved = ${JSON.stringify(saved)};
      const restore = (element, name, value) => value === null ? element.removeAttribute(name) : element.setAttribute(name, value);
      restore(document.documentElement, 'style', saved.rootStyle);
      restore(document.documentElement, 'data-theme', saved.theme);
      restore(document.querySelector('.app-shell'), 'style', saved.shellStyle);
    })()`);
    await viewport(cdp, 1440, 980);
  }
  try {
    for (const [width, height] of [[390, 844], [393, 852], [430, 932]]) {
      await viewport(cdp, width, height);
      await wait(cdp, "document.querySelector('.mobile-inbox-header') && document.querySelector('.mobile-message-list-panel')");
      await evaluate(cdp, "document.querySelector('.mobile-inbox-actions [aria-label=\"搜索邮件\"]').click()");
      await wait(cdp, "document.querySelector('.mobile-search-form input')");
      await evaluate(cdp, `(() => {
        const input = document.querySelector('.mobile-search-form input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '很长的中文搜索文字 with a very long English query');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`);
      await evaluate(cdp, `(() => {
        const form = document.querySelector('.mobile-search-form');
        const parent = form.getBoundingClientRect();
        for (const element of form.children) {
          const box = element.getBoundingClientRect();
          if (box.width && (box.left < parent.left - 1 || box.right > parent.right + 1
            || box.top < parent.top - 1 || box.bottom > parent.bottom + 1)) throw new Error('Mobile search field clipped');
        }
        const input = form.querySelector('input').getBoundingClientRect();
        if (input.width < 100) throw new Error('Mobile search input collapsed');
        if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('Mobile workspace overflow');
      })()`);
      await screenshot(cdp, `header-mobile-search-${width}`);
      await evaluate(cdp, "document.querySelector('.mobile-search-clear').click()");
      await evaluate(cdp, "document.querySelector('.mobile-inbox-header--search [aria-label=\"关闭搜索\"]').click()");
      await wait(cdp, "!document.querySelector('.mobile-inbox-header--search') && !window.history.state?.betterEmailSearch");
    }
  } finally {
    await viewport(cdp, 1440, 980);
  }

}
