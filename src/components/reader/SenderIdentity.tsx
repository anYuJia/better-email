import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MessageSummary } from '../../app/types';
import { senderAvatarTone } from '../../app/messageDetailUtils';
import Avatar from '../Avatar';
import RecipientDetailsDialog, { recipientGroupsForMessage } from './RecipientDetailsDialog';

type SenderIdentityProps = {
  message: MessageSummary;
  onComposeNew?: (fields: { to: string }) => void;
};

function recipientDisplayName(address: string, accountEmail: string) {
  const normalizedAccount = accountEmail.trim().toLocaleLowerCase();
  if (!normalizedAccount) return address;
  const bracketedAddress = address.match(/<([^>]+)>/)?.[1] ?? address;
  return bracketedAddress.trim().toLocaleLowerCase() === normalizedAccount ? '我' : address;
}

export default function SenderIdentity({ message, onComposeNew }: SenderIdentityProps) {
  const senderEmail = message.sender_email.trim();
  const senderName = message.sender_name.trim();
  const hasDistinctName = Boolean(senderName && senderName.toLocaleLowerCase() !== senderEmail.toLocaleLowerCase());
  const senderLabel = hasDistinctName ? senderName : senderEmail || senderName || '未知发件人';
  const recipientGroups = recipientGroupsForMessage(message);
  const recipientCount = recipientGroups.reduce((total, group) => total + group.addresses.length, 0);
  const allRecipientText = recipientGroups
    .flatMap((group) => group.addresses)
    .join(', ');
  const hasRecipientOverflow = recipientCount > 2 || allRecipientText.length > 72;
  const recipientSummary = recipientGroups.map((group) => {
    const label = group.label === '收件人' ? '发给' : group.label;
    const visibleAddresses = (hasRecipientOverflow ? group.addresses.slice(0, 2) : group.addresses)
      .map((address) => recipientDisplayName(address, message.account_email));
    const remainingCount = group.addresses.length - visibleAddresses.length;
    const suffix = remainingCount > 0 ? ` 等 ${remainingCount} 人` : '';
    return `${label} ${visibleAddresses.join(', ')}${suffix}`;
  }).join('，');
  const [detailView, setDetailView] = useState<'recipients' | 'message' | null>(null);

  return (
    <>
      <div className="reader-sender">
        <Avatar
          email={message.sender_email}
          name={message.sender_name}
          className={`reader-avatar avatar-tone-${senderAvatarTone(message.sender_name, message.sender_email)}`}
        />
        <span className="reader-sender-copy">
          <div className="reader-sender-primary-line">
            <strong className="reader-sender-name" title={senderLabel}>
              {!hasDistinctName && senderEmail && onComposeNew ? (
                <button
                  type="button"
                  className="reader-sender-email"
                  title={`写信给 ${senderEmail}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onComposeNew({ to: senderEmail });
                  }}
                >
                  {senderLabel}
                </button>
              ) : senderLabel}
            </strong>
            {recipientSummary && (
              <span className="reader-recipient-summary" title={allRecipientText}>
                {recipientSummary}
              </span>
            )}
            {hasRecipientOverflow && (
              <button
                type="button"
                className="reader-recipient-expand"
                aria-haspopup="dialog"
                aria-expanded={detailView === 'recipients'}
                onClick={(event) => {
                  event.stopPropagation();
                  setDetailView('recipients');
                }}
              >
                展开
              </button>
            )}
          </div>
          {hasDistinctName && senderEmail ? (
            <div className="reader-sender-email-line">
              {onComposeNew ? (
                <button
                  type="button"
                  className="reader-sender-email"
                  title={`写信给 ${senderEmail}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onComposeNew({ to: senderEmail });
                  }}
                >
                  {senderEmail}
                </button>
              ) : (
                <span className="reader-sender-email-text">{message.sender_email}</span>
              )}
            </div>
          ) : null}
          {hasDistinctName && senderEmail && <small className="reader-mobile-sender-address">{senderEmail}</small>}
        </span>
        <button type="button" className="reader-identity-details" aria-haspopup="dialog"
          aria-label="查看邮件详情" aria-expanded={detailView === 'message'}
          onClick={() => setDetailView('message')}>
          详情<ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      {detailView && (
        <RecipientDetailsDialog
          groups={recipientGroups}
          message={detailView === 'message' ? message : undefined}
          onComposeNew={onComposeNew}
          onClose={() => setDetailView(null)}
        />
      )}
    </>
  );
}
