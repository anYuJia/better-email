import type { Message, MessageSummary } from '../../app/types';
import Avatar from '../Avatar';

function senderInitial(message: MessageSummary) {
  return (message.sender_name || message.sender_email || '?').trim().slice(0, 1).toUpperCase();
}

type SenderIdentityProps = {
  message: MessageSummary;
};

export default function SenderIdentity({ message }: SenderIdentityProps) {
  return (
    <div className="reader-sender">
      <Avatar
        email={message.sender_email}
        name={message.sender_name}
        className={`reader-avatar avatar-tone-${Math.abs(message.id) % 6}`}
        fallbackInitial={senderInitial(message)}
      />
      <span className="reader-sender-copy">
        <strong>{message.sender_name || message.sender_email}</strong>
        <span>
          {message.sender_email}
          {message.recipients ? ` 发给 ${message.recipients}` : ''}
        </span>
      </span>
    </div>
  );
}
