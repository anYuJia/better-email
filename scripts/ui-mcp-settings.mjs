/** MCP guide regression matrix; uses the project's existing browser harness. */
export async function testMcpGuideLayouts(cdp, { evaluate, viewport, fill, wait, screenshot }) {
  const saved = await evaluate(cdp, `(() => {
    const root = document.documentElement;
    const guide = document.querySelector('.settings-mcp-guide');
    const names = ['aux', 'secondary', 'body', 'section-title', 'card-title', 'page-title'];
    return {
      width: innerWidth, height: innerHeight, theme: root.getAttribute('data-theme'),
      style: guide.getAttribute('style'), endpoint: document.querySelector('#settings-mcp-endpoint').value,
      tokens: Object.fromEntries(names.map(name => ['--st-font-size-' + name,
        parseFloat(getComputedStyle(guide).getPropertyValue('--st-font-size-' + name))]).filter(([, size]) => Number.isFinite(size)))
    };
  })()`);
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
              return { guideWidth: guide.getBoundingClientRect().width, width: innerWidth,
                overflow: content.scrollWidth > content.clientWidth + 1,
                footerBottom: footer.bottom, height: innerHeight,
                saveDisabled: document.querySelector('.settings-mcp-guide-footer button[aria-label="保存并启用"]').disabled };
            })()`);
            if (layout.guideWidth > layout.width + 1 || layout.overflow || layout.footerBottom > layout.height + 1
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
  } finally {
    await viewport(cdp, saved.width, saved.height);
    await fill(cdp, '#settings-mcp-endpoint', saved.endpoint);
    await evaluate(cdp, `(() => {
      const root = document.documentElement;
      const guide = document.querySelector('.settings-mcp-guide');
      const saved = ${JSON.stringify(saved)};
      if (saved.theme === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', saved.theme);
      if (saved.style === null) guide.removeAttribute('style'); else guide.setAttribute('style', saved.style);
    })()`);
  }
}
