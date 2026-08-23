import { useRef } from 'react';
import { Reply } from 'lucide-react';
import type { Message } from '../../app/types';

type ComposeMode = 'reply' | 'replyAll' | 'forward';

type QuickReplySectionProps = {
  selected: Message;
  quickReplyBody: string;
  onQuickReplyChange: (value: string) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode, prefillBody?: string) => void;
  onSendQuickReply: (message: Message) => void;
};

export default function QuickReplySection({
  selected,
  quickReplyBody,
  onQuickReplyChange,
  onComposeFromMessage,
  onSendQuickReply,
}: QuickReplySectionProps) {
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

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
        ref={replyInputRef}
        aria-label="输入回复"
        value={quickReplyBody}
        onChange={(event) => onQuickReplyChange(event.target.value)}
        placeholder="输入回复"
      />
      <footer>
        <span>{quickReplyBody.trim() ? `${quickReplyBody.trim().length} 字` : ''}</span>
        <div>
          <button
            type="button"
            onClick={() => onComposeFromMessage(selected, 'reply', quickReplyBody)}
          >
            写信窗口
          </button>
          <button
            type="button"
            onClick={() => {
              // Clearing disables this button immediately. Hand focus back to
              // the stable editor before the state update removes the target.
              replyInputRef.current?.focus({ preventScroll: true });
              onQuickReplyChange('');
            }}
            disabled={!quickReplyBody.trim()}
          >
            清空
          </button>
          <button
            className="quick-reply-send"
            type="button"
            onClick={() => {
              // Sending clears the body on success and disables this button.
              // Keep the editing surface as the stable focus destination for
              // both success and retry flows.
              replyInputRef.current?.focus({ preventScroll: true });
              onSendQuickReply(selected);
            }}
            disabled={!quickReplyBody.trim()}
          >
            发送回复
          </button>
        </div>
      </footer>
    </section>
  );
}
