/** MCP guide regression matrix; uses the project's existing browser harness. */
export async function testMcpGuideLayouts(cdp, { evaluate, viewport, fill, wait, screenshot }) {
  const saved = await evaluate(cdp, `(() => {
    const root = document.documentElement;
    const guide = document.querySelector('.settings-mcp-guide');
    const names = ['aux', 'secondary', 'body', 'section-title', 'card-title', 'page-title'];
    return {
      width: innerWidth, height: innerHeight, theme: root.getAttribute('data-theme'),
      viewportHeight: root.style.getPropertyValue('--mobile-viewport-height'),
      style: guide.getAttribute('style'), endpoint: document.querySelector('#settings-mcp-endpoint').value,
      tokens: Object.fromEntries(names.map(name => ['--st-font-size-' + name,
        parseFloat(getComputedStyle(guide).getPropertyValue('--st-font-size-' + name))]).filter(([, size]) => Number.isFinite(size)))
    };
  })()`);
  const exposesToken = await evaluate(cdp, `(() => {
    const token = document.querySelector('#settings-mcp-token').value;
    return Boolean(token && document.querySelector('.settings-mcp-connection-preview').textContent.includes(token));
  })()`);
  if (exposesToken) throw new Error('MCP connection summary exposed its entered token');
  let simulatedViewportHeight = false;
  const longEndpoint = `https://example.com/mcp?说明=${'很长的中文服务配置'.repeat(30)}&description=${'long-English-description-'.repeat(30)}`;
  try {
    for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844], [393, 852], [430, 932]]) {
      await viewport(cdp, width, height);
      for (const theme of ['light', 'dark']) {
        for (const scale of [1, 1.25, 1.5]) {
          await evaluate(cdp, `(() => {
            document.documentElement.dataset.theme = ${JSON.stringify(theme)};
            const guide = document.querySelector('.settings-mcp-guide');
            for (const [name, size] of Object.entries(${JSON.stringify(saved.tokens)})) {
              guide.style.setProperty(name, size * ${scale} + 'px');
            }
            return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          })()`);
          for (const endpoint of ['', longEndpoint]) {
            await fill(cdp, '#settings-mcp-endpoint', endpoint);
            const layout = await evaluate(cdp, `(() => {
              const guide = document.querySelector('.settings-mcp-guide');
              const content = document.querySelector('.settings-mcp-guide-content');
              const footer = document.querySelector('.settings-mcp-guide-footer').getBoundingClientRect();
              const close = document.querySelector('.settings-mcp-guide-close').getBoundingClientRect();
              return { guideWidth: guide.getBoundingClientRect().width, width: innerWidth,
                overflow: content.scrollWidth > content.clientWidth + 1,
                footerBottom: footer.bottom, height: innerHeight,
                closeWidth: close.width, closeHeight: close.height,
                saveDisabled: document.querySelector('.settings-mcp-guide-footer button[aria-label="保存并启用"]').disabled };
            })()`);
            if (layout.guideWidth > layout.width + 1 || layout.overflow || layout.footerBottom > layout.height + 1
              || (width < 500 && (layout.closeWidth < 44 || layout.closeHeight < 44))
              || layout.saveDisabled !== (endpoint === '')) {
              throw new Error(`MCP guide ${width}x${height}, ${theme}, text=${scale}: ${JSON.stringify(layout)}`);
            }
          }
          if (scale === 1.5 && [1440, 390].includes(width)) {
            await wait(cdp, "document.querySelector('.settings-mcp-guide').getAnimations({subtree:true}).every(animation => animation.playState === 'finished')");
            await screenshot(cdp, `settings-mcp-${width}-${theme}-150pct`);
          }
        }
      }
    }
    await viewport(cdp, 390, 844);
    simulatedViewportHeight = await evaluate(cdp, `(() => {
      // Model the actual Android keyboard signal. Writing the CSS mirror alone
      // can race with the app's pending viewport resize handler.
      const viewport = window.visualViewport;
      if (!viewport || Object.prototype.hasOwnProperty.call(viewport, 'height')) throw new Error('Cannot simulate visual viewport height');
      Object.defineProperty(viewport, 'height', { configurable: true, get: () => 360 });
      viewport.dispatchEvent(new Event('resize'));
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))));
    })()`);
    const keyboardLayout = await evaluate(cdp, `(() => {
      const footer = document.querySelector('.settings-mcp-guide-footer').getBoundingClientRect();
      return { footerBottom: footer.bottom, guideHeight: document.querySelector('.settings-mcp-guide').getBoundingClientRect().height,
        viewportHeight: document.documentElement.style.getPropertyValue('--mobile-viewport-height') };
    })()`);
    if (keyboardLayout.footerBottom > 361 || keyboardLayout.guideHeight > 361) {
      throw new Error('MCP guide actions hidden by virtual keyboard: ' + JSON.stringify(keyboardLayout));
    }
    await screenshot(cdp, 'settings-mcp-keyboard-390');
  } finally {
    if (simulatedViewportHeight) await evaluate(cdp, `(() => {
      const viewport = window.visualViewport;
      if (viewport && Object.prototype.hasOwnProperty.call(viewport, 'height')) {
        delete viewport.height;
        viewport.dispatchEvent(new Event('resize'));
      }
    })()`);
    await viewport(cdp, saved.width, saved.height);
    await fill(cdp, '#settings-mcp-endpoint', saved.endpoint);
    await evaluate(cdp, `(() => {
      const root = document.documentElement;
      const guide = document.querySelector('.settings-mcp-guide');
      const saved = ${JSON.stringify(saved)};
      if (saved.theme === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', saved.theme);
      if (saved.viewportHeight) root.style.setProperty('--mobile-viewport-height', saved.viewportHeight);
      else root.style.removeProperty('--mobile-viewport-height');
      if (saved.style === null) guide.removeAttribute('style'); else guide.setAttribute('style', saved.style);
    })()`);
  }
}
