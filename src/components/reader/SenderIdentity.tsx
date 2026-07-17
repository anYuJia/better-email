import type { Message, MessageSummary } from '../../app/types';
import { senderInitial } from '../../app/messageDetailUtils';
import Avatar from '../Avatar';

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
        fallbackInitial={senderInitial(message.sender_name, message.sender_email)}
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
