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

  const showDomainWarning = shouldWarnForLinkDisplay(link.href, link.text);

  return createPortal((
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-confirm-title"
        style={{ width: '480px' }}
      >
        <header>
          <span className="dialog-card-mark dialog-card-mark-warning" aria-hidden="true">
            <ExternalLink size={17} />
          </span>
          <span className="dialog-card-heading">
            <strong id="link-confirm-title">安全链接检查</strong>
            <small>请确认目标链接与显示的域名一致</small>
          </span>
          <button
            className="dialog-card-close"
            type="button"
            title="关闭"
            aria-label="关闭安全检查"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="dialog-card-summary">
          <small>真实目标地址：</small>
          <strong>{link.href}</strong>
        </div>
        {showDomainWarning ? (
          <div className="dialog-link-warning" role="alert">
            ⚠️ 风险提示：显示的链接文本与实际指向的域名不一致！这可能是一个钓鱼链接，请谨慎访问。
          </div>
        ) : (
          <p>您点击的链接将通过系统默认浏览器打开，请确认该目标地址安全。</p>
        )}
        <footer>
          <button
            className="dialog-button dialog-button-secondary"
            type="button"
            onClick={onClose}
          >
            取消访问
          </button>
          <button
            className="dialog-button dialog-button-primary"
            type="button"
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
