import type { MessageSummary } from '../../app/types';
import { senderAvatarTone } from '../../app/messageDetailUtils';
import Avatar from '../Avatar';

type SenderIdentityProps = {
  message: MessageSummary;
  onComposeNew?: (fields: { to: string }) => void;
};

export default function SenderIdentity({ message, onComposeNew }: SenderIdentityProps) {
  const senderEmail = message.sender_email.trim();

  return (
    <div className="reader-sender">
      <Avatar
        email={message.sender_email}
        name={message.sender_name}
        className={`reader-avatar avatar-tone-${senderAvatarTone(message.sender_name, message.sender_email)}`}
      />
      <span className="reader-sender-copy">
        <strong>{message.sender_name || message.sender_email}</strong>
        <span>
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
            message.sender_email
          )}
          {message.recipients ? ` 发给 ${message.recipients}` : ''}
        </span>
      </span>
    </div>
  );
}
