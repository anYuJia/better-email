import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { MessageSummary } from '../../app/types';
import useModalAccessibility from '../../hooks/useModalAccessibility';

export type RecipientGroup = {
  label: string;
  addresses: string[];
};

export function splitRecipientList(value: string): string[] {
  return value
    .split(/[,;，；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function recipientGroupsForMessage(
  message: Pick<MessageSummary, 'recipients' | 'cc' | 'bcc'>,
): RecipientGroup[] {
  return [
    { label: '收件人', addresses: splitRecipientList(message.recipients) },
    { label: '抄送', addresses: splitRecipientList(message.cc) },
    { label: '密送', addresses: splitRecipientList(message.bcc) },
  ].filter((group) => group.addresses.length > 0);
}

type RecipientDetailsDialogProps = {
  groups: RecipientGroup[];
  onClose: () => void;
};

export default function RecipientDetailsDialog({ groups, onClose }: RecipientDetailsDialogProps) {
  const titleId = useId();
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
      onMouseDown={(event) => {
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
            <strong id={titleId}>收件人详情</strong>
            <small>共 {addressCount} 个地址</small>
          </span>
          <button
            ref={closeRef}
            className="dialog-card-close"
            type="button"
            title="关闭"
            aria-label="关闭收件人详情"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="recipient-details-groups">
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
