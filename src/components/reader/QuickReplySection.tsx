import { Reply } from 'lucide-react';
import type { Message } from '../../app/types';

type ComposeMode = 'reply' | 'replyAll' | 'forward';

type QuickReplySectionProps = {
  selected: Message;
  quickReplyBody: string;
  onQuickReplyChange: (value: string) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode) => void;
  onSendQuickReply: (message: Message) => void;
};

export default function QuickReplySection({
  selected,
  quickReplyBody,
  onQuickReplyChange,
  onComposeFromMessage,
  onSendQuickReply,
}: QuickReplySectionProps) {
  return (
    <section className="quick-reply" aria-label="快速回复">
      <header>
        <div>
          <strong>回复</strong>
          <span>发给 {selected.sender_name || selected.sender_email}</span>
        </div>
        <Reply size={16} />
      </header>
      <textarea
        value={quickReplyBody}
        onChange={(event) => onQuickReplyChange(event.target.value)}
        placeholder="输入回复"
      />
      <footer>
        <span>{quickReplyBody.trim() ? `${quickReplyBody.trim().length} 字` : ''}</span>
        <div>
          <button type="button" onClick={() => onComposeFromMessage(selected, 'reply')}>写信窗口</button>
          <button type="button" onClick={() => onQuickReplyChange('')} disabled={!quickReplyBody.trim()}>
            清空
          </button>
          <button className="quick-reply-send" type="button" onClick={() => onSendQuickReply(selected)} disabled={!quickReplyBody.trim()}>
            发送回复
          </button>
        </div>
      </footer>
    </section>
  );
}
