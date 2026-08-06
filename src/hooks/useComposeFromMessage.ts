import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type {
  Account,
  Attachment,
  DraftInput,
  Message,
  MessageSummary,
} from '../app/types';
import {
  prefixedSubject,
  quoteMessage,
  replyThreadingHeaders,
} from '../mailUtils';
import {
  buildForwardAttachmentPlan,
  forwardAttachmentStatus,
} from '../app/forwarding';
import { invoke } from '../tauriBridge';

type ComposeFromMessageOptions = {
  account: Account | null;
  openComposer: (draft?: DraftInput, options?: { restoreAutosave?: boolean }) => void;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useComposeFromMessage({
  account,
  openComposer,
  setStatus,
}: ComposeFromMessageOptions) {
  const composeFromMessage = useCallback(async (message: MessageSummary, mode: 'reply' | 'replyAll' | 'forward') => {
    let fullMessage: Message;
    if ('body' in message && typeof (message as Message).body === 'string') {
      fullMessage = message as Message;
    } else {
      fullMessage = await invoke<Message>('get_message_detail', { messageId: message.id });
    }
    const threading = mode === 'forward' ? null : replyThreadingHeaders(fullMessage);
    const replyRecipients = mode === 'forward' ? '' : fullMessage.sender_email;
    const includeOriginalRecipients =
      mode === 'replyAll'
        ? fullMessage.recipients
            .split(/[;,]/)
            .map((recipient) => recipient.trim())
            .filter((recipient) => recipient && recipient !== account?.email)
            .join(', ')
        : '';
    let forwardPlan = buildForwardAttachmentPlan([]);
    if (mode === 'forward' && fullMessage.has_attachments) {
      try {
        const sourceAttachments = await invoke<Attachment[]>('list_attachments', {
          messageId: fullMessage.id,
        });
        forwardPlan = buildForwardAttachmentPlan(
          sourceAttachments,
          fullMessage.attachment_count,
        );
      } catch {
        forwardPlan = {
          attachments: [],
          unavailableCount: fullMessage.attachment_count,
          totalCount: fullMessage.attachment_count,
        };
      }
    }
    openComposer({
      draft_id: 0,
      account_id: fullMessage.account_id,
      identity_id: 0,
      to: replyRecipients,
      cc: includeOriginalRecipients,
      bcc: '',
      subject: prefixedSubject(fullMessage.subject, mode === 'forward' ? 'Fwd' : 'Re'),
      body: quoteMessage(fullMessage),
      html_body: '',
      send_at: '',
      attachments: mode === 'forward' ? forwardPlan.attachments : [],
      in_reply_to: threading?.in_reply_to ?? '',
      references: threading?.references ?? '',
    });
    setStatus(
      mode === 'forward'
        ? forwardAttachmentStatus(forwardPlan)
        : mode === 'replyAll'
          ? '已创建回复全部草稿'
          : '已创建回复草稿',
    );
  }, [account, openComposer, setStatus]);

  const editDraftMessage = useCallback(async (message: Message) => {
    const draftAttachments = await invoke<Attachment[]>('list_attachments', { messageId: message.id });
    openComposer({
      draft_id: message.id,
      account_id: message.account_id,
      identity_id: 0,
      to: message.recipients,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      body: message.body,
      html_body: message.sanitized_html,
      send_at: '',
      in_reply_to: message.in_reply_to_header ?? '',
      references: message.references_header ?? '',
      attachments: draftAttachments.map((attachment) => ({
        filename: attachment.filename,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        local_path: attachment.local_path,
        content_id: attachment.content_id,
        is_inline: attachment.is_inline,
      })),
    });
    setStatus('已打开草稿继续编辑');
  }, [openComposer, setStatus]);

  return {
    composeFromMessage,
    editDraftMessage,
  };
}
