import { useState } from 'react';
import type { MessageSummary } from '../../app/types';
import { senderAvatarTone } from '../../app/messageDetailUtils';
import Avatar from '../Avatar';
import RecipientDetailsDialog, { recipientGroupsForMessage } from './RecipientDetailsDialog';

type SenderIdentityProps = {
  message: MessageSummary;
  onComposeNew?: (fields: { to: string }) => void;
};

export default function SenderIdentity({ message, onComposeNew }: SenderIdentityProps) {
  const senderEmail = message.sender_email.trim();
  const recipientGroups = recipientGroupsForMessage(message);
  const recipientCount = recipientGroups.reduce((total, group) => total + group.addresses.length, 0);
  const allRecipientText = recipientGroups
    .flatMap((group) => group.addresses)
    .join(', ');
  const hasRecipientOverflow = recipientCount > 2 || allRecipientText.length > 72;
  const recipientSummary = recipientGroups.map((group) => {
    const label = group.label === '收件人' ? '发给' : group.label;
    const visibleAddresses = hasRecipientOverflow ? group.addresses.slice(0, 2) : group.addresses;
    const remainingCount = group.addresses.length - visibleAddresses.length;
    const suffix = remainingCount > 0 ? ` 等 ${remainingCount} 人` : '';
    return `${label} ${visibleAddresses.join(', ')}${suffix}`;
  }).join('，');
  const [recipientDetailsOpen, setRecipientDetailsOpen] = useState(false);

  return (
    <>
      <div className="reader-sender">
        <Avatar
          email={message.sender_email}
          name={message.sender_name}
          className={`reader-avatar avatar-tone-${senderAvatarTone(message.sender_name, message.sender_email)}`}
        />
        <span className="reader-sender-copy">
          <strong>{message.sender_name || message.sender_email}</strong>
          <span className="reader-sender-email-line">
            {senderEmail && onComposeNew ? (
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
            {recipientSummary && (
              <span className="reader-recipient-summary">{recipientSummary}</span>
            )}
            {hasRecipientOverflow && (
              <button
                type="button"
                className="reader-recipient-expand"
                aria-haspopup="dialog"
                aria-expanded={recipientDetailsOpen}
                onClick={(event) => {
                  event.stopPropagation();
                  setRecipientDetailsOpen(true);
                }}
              >
                展开
              </button>
            )}
          </span>
        </span>
      </div>
      {recipientDetailsOpen && (
        <RecipientDetailsDialog
          groups={recipientGroups}
          onClose={() => setRecipientDetailsOpen(false)}
        />
      )}
    </>
  );
}
