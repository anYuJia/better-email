import type { Message } from '../../app/types';

function senderInitial(message: Message) {
  return (message.sender_name || message.sender_email || '?').trim().slice(0, 1).toUpperCase();
}

type SenderIdentityProps = {
  message: Message;
};

export default function SenderIdentity({ message }: SenderIdentityProps) {
  return (
    <div className="reader-sender">
      <span className={`reader-avatar avatar-tone-${Math.abs(message.id) % 6}`} aria-hidden="true">
        {senderInitial(message)}
      </span>
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
