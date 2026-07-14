import React, { useEffect, useRef } from 'react';

interface EmailShadowViewProps {
  html: string;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenuCapture?: (event: React.MouseEvent<HTMLDivElement>) => void;
  className?: string;
}

export default function EmailShadowView({
  html,
  onClick,
  onContextMenu,
  onContextMenuCapture,
  className,
}: EmailShadowViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRootRef = useRef<ShadowRoot | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!shadowRootRef.current) {
      shadowRootRef.current = container.attachShadow({ mode: 'open' });
    }

    const shadowRoot = shadowRootRef.current;

    // Base styles for email content, isolated from the host app, and mimicking the styles previously targeted at .reader-html children.
    const styleContent = `
      :host {
        display: block;
        overflow-wrap: anywhere;
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
        transition: box-shadow 120ms ease, opacity 120ms ease;
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

    shadowRoot.innerHTML = `<style>${styleContent}</style><div>${html}</div>`;
  }, [html]);

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
