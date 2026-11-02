import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
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
import { IPC } from '../ipc/commands';
import type { QuickReplySnapshot } from './useQuickReplyDraft';
import type { OpenComposerOptions } from './useComposerController';

type ComposeFromMessageOptions = {
  account: Account | null;
  openComposer: (draft?: DraftInput, options?: OpenComposerOptions) => boolean | void;
  captureRequestGuard?: () => () => boolean;
  resolveReplySource?: (message: MessageSummary) => QuickReplySnapshot | undefined;
  resolveReplyPrefill?: (message: MessageSummary) => string | undefined;
  onDraftOpened?: (accountId: number) => void;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useComposeFromMessage({
  account,
  openComposer,
  captureRequestGuard,
  resolveReplyPrefill,
  resolveReplySource,
  onDraftOpened,
  setStatus,
}: ComposeFromMessageOptions) {
  const requestEpoch = useRef(0);
  useEffect(() => () => { requestEpoch.current += 1; }, []);
  const beginRequest = useCallback(() => {
    const epoch = ++requestEpoch.current;
    const isContextCurrent = captureRequestGuard?.();
    return () => epoch === requestEpoch.current && (isContextCurrent?.() ?? true);
  }, [captureRequestGuard]);

  const composeFromMessage = useCallback(async (
    message: MessageSummary,
    mode: 'reply' | 'replyAll' | 'forward',
    prefillBody?: string,
  ) => {
    const isCurrent = beginRequest();
    let fullMessage: Message;
    if ('body' in message && typeof (message as Message).body === 'string') {
      fullMessage = message as Message;
    } else {
      try {
        fullMessage = await invoke<Message>(IPC.GetMessageDetail, { messageId: message.id });
      } catch (error) {
        if (!isCurrent()) return false;
        throw error;
      }
    }
    if (!isCurrent()) return false;
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
        const sourceAttachments = await invoke<Attachment[]>(IPC.ListAttachments, {
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
    if (!isCurrent()) return false;
    const quotedBody = quoteMessage(fullMessage);
    const source = mode === 'forward' ? undefined : resolveReplySource?.(fullMessage);
    const prefill = mode === 'forward' ? '' : (prefillBody ?? source?.body ?? resolveReplyPrefill?.(fullMessage) ?? '');
    const replyLead = prefill.trimEnd();
    // Explicit generated text (including an empty string) must never consume
    // a different inline draft merely because it replies to the same message.
    const ownsSource = source?.key === `${fullMessage.account_id}:${fullMessage.id}`
      && source.body === prefill && mode !== 'forward';
    const opened = openComposer({
      ...(ownsSource ? { quick_reply_source: { ...source, mode } } : {}),
      draft_id: 0,
      account_id: fullMessage.account_id,
      identity_id: 0,
      to: replyRecipients,
      cc: includeOriginalRecipients,
      bcc: '',
      subject: prefixedSubject(fullMessage.subject, mode === 'forward' ? 'Fwd' : 'Re'),
      body: replyLead ? `${replyLead}\n\n${quotedBody}` : quotedBody,
      html_body: '',
      send_at: '',
      attachments: mode === 'forward' ? forwardPlan.attachments : [],
      in_reply_to: threading?.in_reply_to ?? '',
      references: threading?.references ?? '',
    }, { replaceExisting: true });
    if (opened === false) return false;
    onDraftOpened?.(fullMessage.account_id);
    setStatus(
      replyLead
        ? '已在写信窗口继续回复'
        : mode === 'forward'
          ? forwardAttachmentStatus(forwardPlan)
          : mode === 'replyAll'
            ? '已创建回复全部草稿'
            : '已创建回复草稿',
    );
    return true;
  }, [account, beginRequest, openComposer, onDraftOpened, resolveReplyPrefill, resolveReplySource, setStatus]);

  const editDraftMessage = useCallback(async (message: Message) => {
    const isCurrent = beginRequest();
    let draftAttachments: Attachment[];
    try {
      draftAttachments = await invoke<Attachment[]>(IPC.ListAttachments, { messageId: message.id });
    } catch (error) {
      if (!isCurrent()) return false;
      throw error;
    }
    if (!isCurrent()) return false;
    const opened = openComposer({
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
    }, { replaceExisting: true });
    if (opened === false) return false;
    onDraftOpened?.(message.account_id);
    setStatus('已打开草稿继续编辑');
    return true;
  }, [beginRequest, openComposer, onDraftOpened, setStatus]);

  return {
    composeFromMessage,
    editDraftMessage,
  };
}
