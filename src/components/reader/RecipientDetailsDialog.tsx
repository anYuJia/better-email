import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { MessageSummary } from '../../app/types';
import { formatDate } from '../../mailUtils';
import useModalAccessibility from '../../hooks/useModalAccessibility';
import { splitRecipientTokens } from '../composer/recipientAddresses';

export type RecipientGroup = {
  label: string;
  addresses: string[];
};

export function recipientGroupsForMessage(
  message: Pick<MessageSummary, 'recipients' | 'cc' | 'bcc'>,
): RecipientGroup[] {
  return [
    { label: '收件人', addresses: splitRecipientTokens(message.recipients) },
    { label: '抄送', addresses: splitRecipientTokens(message.cc) },
    { label: '密送', addresses: splitRecipientTokens(message.bcc) },
  ].filter((group) => group.addresses.length > 0);
}

type RecipientDetailsDialogProps = {
  groups: RecipientGroup[];
  message?: MessageSummary;
  onComposeNew?: (fields: { to: string }) => void;
  onClose: () => void;
};

export default function RecipientDetailsDialog({ groups, message, onComposeNew, onClose }: RecipientDetailsDialogProps) {
  const titleId = useId();
  const title = message ? '邮件详情' : '收件人详情';
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const addressCount = groups.reduce((total, group) => total + group.addresses.length, 0);

  useModalAccessibility({
    dialogRef,
    backdropRef,
    initialFocusRef: closeRef,
    onEscape: onClose,
  });

  return createPortal(
    <div
      ref={backdropRef}
      className="dialog-backdrop recipient-details-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog-card recipient-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <span className="dialog-card-heading">
            <strong id={titleId}>{title}</strong>
            {!message && <small>共 {addressCount} 个地址</small>}
          </span>
          <button
            ref={closeRef}
            className="dialog-card-close"
            type="button"
            title="关闭"
            aria-label={`关闭${title}`}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="recipient-details-groups">
          {message && <>
            <section className="recipient-details-group">
              <h3>发件人</h3>
              <p>{message.sender_name || message.sender_email || '未知发件人'}</p>
              {message.sender_email && onComposeNew ? (
                <button type="button" className="reader-detail-address" onClick={() => {
                  onClose();
                  onComposeNew({ to: message.sender_email });
                }}>写信给 {message.sender_email}</button>
              ) : message.sender_email && message.sender_name && <p>{message.sender_email}</p>}
            </section>
            <section className="recipient-details-group"><h3>收件时间</h3>
              <time dateTime={message.received_at}>{formatDate(message.received_at)}</time>
            </section>
            {message.account_email && <section className="recipient-details-group">
              <h3>所属邮箱</h3><p>{message.account_email}</p>
            </section>}
          </>}
          {groups.map((group) => (
            <section key={group.label} className="recipient-details-group">
              <h3>{group.label}</h3>
              <ul>
                {group.addresses.map((address) => <li key={`${group.label}-${address}`}>{address}</li>)}
              </ul>
            </section>
          ))}
        </div>

        <footer>
          <button className="dialog-button dialog-button-secondary" type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
