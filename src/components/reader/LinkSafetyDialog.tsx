import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { parseMailtoUrl, shouldWarnForLinkDisplay } from '../../mailUtils';
import { invoke } from '../../tauriBridge';

export type ConfirmedLink = { href: string; text: string } | null;

type ComposeNewFields = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
};

type LinkSafetyDialogProps = {
  link: { href: string; text: string } | null;
  onClose: () => void;
  onComposeNew: (fields?: ComposeNewFields) => void;
};

export default function LinkSafetyDialog({ link, onClose, onComposeNew }: LinkSafetyDialogProps) {
  if (!link) return null;

  return createPortal((
    <div
      className="settings-cache-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="settings-cache-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-confirm-title"
        style={{ width: '480px' }}
      >
        <header>
          <span className="settings-cache-confirm-mark" aria-hidden="true" style={{ background: '#fef3c7', color: '#d97706' }}>
            <ExternalLink size={17} />
          </span>
          <span>
            <strong id="link-confirm-title">安全链接检查</strong>
            <small>请确认目标链接与显示的域名一致</small>
          </span>
          <button
            className="icon-only-action"
            type="button"
            title="关闭"
            aria-label="关闭安全检查"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="settings-cache-confirm-summary" style={{ background: '#fffbeb', borderLeft: '3px solid #f59e0b', wordBreak: 'break-all' }}>
          <div style={{ fontSize: '12px', color: '#4b5563', marginBottom: '4px' }}>真实目标地址：</div>
          <strong style={{ fontSize: '13px', color: '#1f2937', display: 'block' }}>{link.href}</strong>
        </div>
        <div style={{ fontSize: '12.5px', color: '#374151', margin: '14px 0', lineHeight: '1.5' }}>
          {(() => {
            const showDomainWarning = shouldWarnForLinkDisplay(link.href, link.text);

            if (showDomainWarning) {
              return (
                <div style={{ padding: '10px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#991b1b', fontWeight: 'bold' }}>
                  ⚠️ 风险提示：显示的链接文本与实际指向的域名不一致！这可能是一个钓鱼链接，请谨慎访问。
                </div>
              );
            }
            return '您点击的链接将通过系统默认浏览器打开，请确认该目标地址安全。';
          })()}
        </div>
        <footer>
          <button
            className="secondary"
            type="button"
            onClick={onClose}
          >
            取消访问
          </button>
          <button
            className="primary"
            type="button"
            style={{ background: 'var(--ui-accent, #0a7aff)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            onClick={async () => {
              if (link.href.toLowerCase().startsWith('mailto:')) {
                const parsed = parseMailtoUrl(link.href);
                onComposeNew?.(parsed);
              } else {
                await invoke('open_url', { url: link.href });
              }
              onClose();
            }}
          >
            继续访问
          </button>
        </footer>
      </section>
    </div>
  ), document.body);
}
