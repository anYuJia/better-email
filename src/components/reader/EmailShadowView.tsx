import React, { useEffect, useRef } from 'react';

function isWebLink(href: string): boolean {
  const normalized = href.trim().toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://');
}

function applyLinksVisibility(contentDiv: HTMLDivElement, linksHidden: boolean) {
  contentDiv.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (!isWebLink(href)) return;
    const hasImageContent = Boolean(anchor.querySelector('img'));
    if (linksHidden) {
      if (anchor.dataset.betterEmailHref) return;
      anchor.dataset.betterEmailHref = href;
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
      const originalHref = anchor.dataset.betterEmailHref;
      if (!originalHref) return;
      anchor.setAttribute('href', originalHref);
      if (!hasImageContent) {
        anchor.textContent = originalHref;
      } else {
        anchor.removeAttribute('data-better-email-hidden-image-link');
        anchor.removeAttribute('aria-label');
      }
      delete anchor.dataset.betterEmailHref;
      anchor.removeAttribute('data-better-email-hidden-link');
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!shadowRootRef.current) {
      const shadowRoot = container.attachShadow({ mode: 'open' });
      shadowRootRef.current = shadowRoot;

      // Base styles for email content, isolated from the host app, and mimicking the styles previously targeted at .reader-html children.
      const styleContent = `
        :host {
          display: block;
          overflow-wrap: anywhere;
          -webkit-user-select: text;
          user-select: text;
        }
        * {
          box-sizing: border-box;
        }
        p, ul, ol, blockquote, table {
          margin-top: 0;
          margin-bottom: 14px;
        }
        a {
          color: var(--accent, #0066cc);
        }
        a[data-better-email-hidden-link] {
          color: var(--accent, #0066cc);
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
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
        }
        blockquote {
          margin: 14px 0 0;
          padding: 10px 12px;
          border-left: 3px solid #c7d2de;
          border-radius: 0 7px 7px 0;
          color: #58636f;
          background: #f8f9fb;
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
      applyLinksVisibility(contentDiv, linksHidden);
    }
  }, [html, linksHidden]);

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
