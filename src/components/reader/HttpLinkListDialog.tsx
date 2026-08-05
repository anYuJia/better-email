import { createPortal } from 'react-dom';
import { Link2, X } from 'lucide-react';
import type { PlainHttpLink } from '../../mailUtils';

type HttpLinkListDialogProps = {
  links: PlainHttpLink[];
  onClose: () => void;
  onOpenLink: (href: string, text: string) => void;
};

export default function HttpLinkListDialog({ links, onClose, onOpenLink }: HttpLinkListDialogProps) {
  if (links.length === 0) return null;

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
        aria-labelledby="http-links-dialog-title"
        style={{ width: '480px' }}
      >
        <header>
          <span className="settings-cache-confirm-mark" aria-hidden="true" style={{ background: '#fef3c7', color: '#d97706' }}>
            <Link2 size={17} />
          </span>
          <span>
            <strong id="http-links-dialog-title">正文中的明文 HTTP 链接</strong>
            <small>链接未加密，打开前请核对目标地址</small>
          </span>
          <button
            className="icon-only-action"
            type="button"
            title="关闭"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="http-links-list">
          {links.map((link, index) => (
            <div className="http-link-row" key={`${link.href}-${index}`}>
              <b className="http-link-index">{index + 1}</b>
              <span>
                <strong>{link.text || link.href}</strong>
                <small>{link.href}</small>
              </span>
              <button type="button" onClick={() => onOpenLink(link.href, link.text)}>
                打开
              </button>
            </div>
          ))}
        </div>
        <footer>
          <button className="secondary" type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  ), document.body);
}
