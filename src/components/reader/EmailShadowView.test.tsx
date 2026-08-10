import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import EmailShadowView from './EmailShadowView';

const HTML_WITH_LINKED_IMAGE = `
  <div>
    <p>正文链接：<a href="https://example.com/page">查看页面</a></p>
    <p><a href="https://example.com/photo"><img src="https://example.com/photo.png" alt="照片"></a></p>
    <p><img src="https://example.com/bare.png" alt="裸图"></p>
  </div>
`;

function renderView(onClick = vi.fn(), onLinkClick = vi.fn(), linksHidden = false) {
  const view = render(
    <EmailShadowView
      className="reader-html"
      html={HTML_WITH_LINKED_IMAGE}
      linksHidden={linksHidden}
      onClick={onClick}
      onLinkClick={onLinkClick}
    />,
  );
  const container = document.querySelector('.reader-html');
  const shadowRoot = container?.shadowRoot;
  return { view, onClick, onLinkClick, shadowRoot, container };
}

describe('EmailShadowView image vs link click routing', () => {
  afterEach(() => cleanup());

  it('passes bare image clicks to the host (image preview) without link handling', () => {
    const { shadowRoot, onClick, onLinkClick } = renderView();
    const image = shadowRoot?.querySelector('img[alt="裸图"]') as HTMLImageElement;
    expect(image).not.toBeNull();
    image.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it('routes clicks on <a><img></a> to the host image preview, never to link security handling', () => {
    const { shadowRoot, onClick, onLinkClick } = renderView();
    const image = shadowRoot?.querySelector('img[alt="照片"]') as HTMLImageElement;
    expect(image).not.toBeNull();
    const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true });
    image.dispatchEvent(event);

    // 图片目标必须优先进入图片预览：宿主 onClick 收到事件，onLinkClick 不得触发。
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLinkClick).not.toHaveBeenCalled();
    // 只阻止 <a> 的浏览器导航，事件仍会穿过 Shadow DOM 到宿主预览逻辑。
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps a linked image previewable when links are hidden, while hiding ordinary web links', () => {
    const { shadowRoot, onClick, onLinkClick } = renderView(vi.fn(), vi.fn(), true);
    const linkedImage = shadowRoot?.querySelector('img[alt="照片"]') as HTMLImageElement;
    const imageAnchor = linkedImage.closest('a') as HTMLAnchorElement;
    const textAnchor = shadowRoot?.querySelector('p a') as HTMLAnchorElement;

    // 默认安全设置移除图片链接的导航能力，但不会用“已隐藏链接”覆盖图片节点。
    expect(linkedImage).not.toBeNull();
    expect(imageAnchor.getAttribute('href')).toBeNull();
    expect(imageAnchor.hasAttribute('data-better-email-hidden-image-link')).toBe(true);
    expect(textAnchor.getAttribute('href')).toBeNull();
    expect(textAnchor.textContent).toBe('已隐藏链接');

    linkedImage.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it('keeps link-text clicks on the safe-link path (preventDefault + onLinkClick)', () => {
    const { shadowRoot, onClick, onLinkClick } = renderView();
    const anchor = shadowRoot?.querySelector('a[href="https://example.com/page"]') as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    const event = new MouseEvent('click', { bubbles: true, composed: true, cancelable: true });
    anchor.dispatchEvent(event);

    expect(onLinkClick).toHaveBeenCalledTimes(1);
    expect(onLinkClick).toHaveBeenCalledWith('https://example.com/page', '查看页面');
    expect(event.defaultPrevented).toBe(true);
    // 链接安全处理会吞掉事件，宿主图片预览逻辑不会收到。
    expect(onClick).not.toHaveBeenCalled();
  });
});
