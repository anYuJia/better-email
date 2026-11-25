import React, { useEffect, useRef } from 'react';

function isWebLink(href: string): boolean {
  const normalized = href.trim().toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://');
}

type HiddenLink = { href: string; children: Node[] | null; label: string | null };

function enableImagePreviews(content: HTMLDivElement) {
  const attributes = ['tabindex', 'role', 'aria-haspopup', 'aria-label'] as const;
  const originals = new Map<HTMLImageElement, (string | null)[]>();
  for (const image of content.querySelectorAll<HTMLImageElement>('img[src]:not([data-better-email-inline-cid])')) {
    if (!image.getAttribute('src')?.trim() || image.closest('a[href], [hidden], [aria-hidden="true"], [role="presentation"], [role="none"]')) continue;
    if (image.alt === '' && image.hasAttribute('alt') && !image.getAttribute('aria-label')) continue;
    originals.set(image, attributes.map((name) => image.getAttribute(name)));
    const description = image.getAttribute('aria-label') || image.alt;
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-haspopup', 'dialog');
    image.setAttribute('aria-label', description ? `预览图片，${description}` : '预览图片');
  }
  function activate(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLImageElement) || !originals.has(event.target)) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) event.target.click();
  }
  content.addEventListener('keydown', activate);
  return () => {
    content.removeEventListener('keydown', activate);
    // Revealing a web link gives the enclosing anchor its native keyboard action back.
    for (const [image, values] of originals) {
      attributes.forEach((name, index) => {
        const value = values[index];
        if (value === null) image.removeAttribute(name);
        else image.setAttribute(name, value);
      });
    }
  };
}

function applyLinksVisibility(contentDiv: HTMLDivElement, linksHidden: boolean, hiddenLinks: Map<HTMLAnchorElement, HiddenLink>) {
  contentDiv.querySelectorAll<HTMLAnchorElement>('a').forEach((anchor) => {
    if (linksHidden) {
      if (hiddenLinks.has(anchor)) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!isWebLink(href)) return;
      const hasImageContent = Boolean(anchor.querySelector('img'));
      hiddenLinks.set(anchor, {
        href,
        children: hasImageContent ? null : Array.from(anchor.childNodes),
        label: anchor.getAttribute('aria-label'),
      });
      anchor.removeAttribute('href');
      anchor.setAttribute('data-better-email-hidden-link', 'true');
      if (hasImageContent) {
        // 链接目标需要隐藏，但绝不能通过 textContent 覆盖掉图片本身。
        // 无 href 的图片容器不再导航，点击会冒泡给宿主的图片预览逻辑。
        anchor.setAttribute('data-better-email-hidden-image-link', 'true');
        anchor.setAttribute('aria-label', '已隐藏链接中的图片');
      } else {
        anchor.textContent = '已隐藏链接';
      }
    } else {
      const original = hiddenLinks.get(anchor);
      if (!original) return;
      anchor.setAttribute('href', original.href);
      if (original.children) anchor.replaceChildren(...original.children);
      anchor.removeAttribute('data-better-email-hidden-image-link');
      if (original.label === null) anchor.removeAttribute('aria-label');
      else anchor.setAttribute('aria-label', original.label);
      anchor.removeAttribute('data-better-email-hidden-link');
      hiddenLinks.delete(anchor);
    }
  });
}

interface EmailShadowViewProps {
  html: string;
  linksHidden?: boolean;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenuCapture?: (event: React.MouseEvent<HTMLDivElement>) => void;
  className?: string;
  onLinkClick?: (href: string, text: string) => void;
}

export default function EmailShadowView({
  html,
  linksHidden = false,
  onClick,
  onContextMenu,
  onContextMenuCapture,
  className,
  onLinkClick,
}: EmailShadowViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);
  const contentDivRef = useRef<HTMLDivElement | null>(null);
  const hiddenLinksRef = useRef(new Map<HTMLAnchorElement, HiddenLink>());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!shadowRootRef.current) {
      const shadowRoot = container.attachShadow({ mode: 'open' });
      shadowRootRef.current = shadowRoot;

      // Base styles for email content, isolated from the host app, and mimicking the styles previously targeted at .reader-html children.
      // Semantic tokens (inherited from :root via the host element) keep dark
      // mode and theme switching working inside the Shadow DOM.
      const styleContent = `
        :host {
          display: block;
          overflow-wrap: anywhere;
          -webkit-user-select: text;
          user-select: text;
          color: var(--ui-text);
          color-scheme: light dark;
        }
        * {
          box-sizing: border-box;
        }
        p, ul, ol, blockquote, table {
          margin-top: 0;
          margin-bottom: 14px;
        }
        a {
          color: var(--ui-text-accent);
        }
        img[role="button"]:focus-visible {
          outline: var(--ui-focus-outline);
          outline-offset: 2px;
          box-shadow: var(--ui-focus-ring);
        }
        a[data-better-email-hidden-link] {
          color: var(--ui-text-tertiary);
          text-decoration: none;
          cursor: default;
        }
        img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
        }
        img[data-better-email-inline-cid] {
          display: none;
        }
        img:not([data-better-email-inline-cid]) {
          cursor: zoom-in;
          transition: var(--ui-transition-box-shadow-opacity-fast);
          border-radius: 8px;
        }
        img:not([data-better-email-inline-cid]):hover {
          box-shadow: var(--ui-shadow-popover);
        }
        blockquote {
          margin: 14px 0 0;
          padding: 10px 12px;
          border-left: 3px solid var(--ui-border-strong);
          border-radius: 0 7px 7px 0;
          color: var(--ui-text-secondary);
          background: var(--ui-surface-muted);
        }
        /* 暗色主题下的对比度保护：防止未声明背景的纯黑字邮件在暗色模式下不可读 */
        :host-context([data-theme="dark"]) .reader-shadow-content {
          color-scheme: dark;
          color: var(--ui-text);
        }
        :host-context([data-theme="dark"]) .reader-shadow-content :is(
          [style*="color: #000"],
          [style*="color:#000"],
          [style*="color: black"],
          [style*="color:black"],
          [style*="color: rgb(0, 0, 0)"],
          [style*="color:rgb(0,0,0)"],
          font[color="#000000"],
          font[color="#000"]
        ):not([style*="background"]) {
          color: var(--ui-text);
        }
      `;
      const style = document.createElement('style');
      style.textContent = styleContent;
      const contentDiv = document.createElement('div');
      contentDiv.className = 'reader-shadow-content';
      shadowRoot.append(style, contentDiv);
      contentDivRef.current = contentDiv;
    }

    // Update only the body content; the shadow root and its styles stay stable.
    const contentDiv = contentDivRef.current;
    if (contentDiv) {
      contentDiv.innerHTML = html;
      hiddenLinksRef.current.clear();
    }
  }, [html]);

  // Privacy toggles must not recreate the mail body, reload images, or discard
  // text formatting. Only update the anchors affected by this policy.
  useEffect(() => {
    const contentDiv = contentDivRef.current;
    if (!contentDiv) return;
    applyLinksVisibility(contentDiv, linksHidden, hiddenLinksRef.current);
    if (onClick) return enableImagePreviews(contentDiv);
  }, [html, linksHidden, onClick]);

  useEffect(() => {
    const shadowRoot = shadowRootRef.current;
    if (!shadowRoot) return;

    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // 点击链接内的图片时，目标是图片本身：必须把事件放行到宿主层，
      // 由 useImagePreview 优先进入图片预览。只阻止 a 的原生导航，不停止
      // 冒泡，否则图片会在预览打开后仍意外跳转到远程链接。
      if (target instanceof Element && target.closest('img')) {
        event.preventDefault();
        return;
      }
      const anchor = target.closest('a');
      if (anchor) {
        const href = anchor.getAttribute('href');
        if (href) {
          event.preventDefault();
          event.stopPropagation();
          if (onLinkClick) {
            onLinkClick(href, anchor.innerText || anchor.textContent || '');
          }
        }
      }
    };

    shadowRoot.addEventListener('click', handleLinkClick as EventListener);
    return () => {
      shadowRoot.removeEventListener('click', handleLinkClick as EventListener);
    };
  }, [onLinkClick]);

  return (
    <div
      ref={containerRef}
      className={className}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onContextMenuCapture={onContextMenuCapture}
    />
  );
}
