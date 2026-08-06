import { useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  emptyDraft,
  isDraftEmpty,
  type SendUndoDelaySeconds,
} from '../app/appConfig';
import type {
  Account,
  DraftInput,
  DraftSaveReport,
  FolderRole,
  Message,
  MessageSummary,
  OutboxItem,
} from '../app/types';
import type { PendingSendUndo } from '../components/UndoSnackbarStack';
import { formatDate, prefixedSubject, quoteMessage, replyThreadingHeaders } from '../mailUtils';
import { flowInfo, flowWarn } from '../app/logger';
import { invoke } from '../tauriBridge';

type ComposerSendOptions = {
  draft: DraftInput;
  setDraft: Dispatch<SetStateAction<DraftInput>>;
  quickReplyBody: string;
  setQuickReplyBody: Dispatch<SetStateAction<string>>;
  account: Account | null;
  selectedId: number | null;
  pendingSendUndo: PendingSendUndo | null;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
  setPendingSendUndo: Dispatch<SetStateAction<PendingSendUndo | null>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  showToast: (text: string) => void;
  draftInputForCurrentAccount: (input: DraftInput) => DraftInput;
  threadingForDraft: (input: DraftInput) => { in_reply_to: string; references: string } | null;
  clearComposerAutosave: () => void;
  closeComposer: () => void;
  forceCloseComposer: () => void;
  focusMailboxRole: (role: FolderRole, targetAccountId: number | null, statusMessage: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  loadMeta: (folderId?: number | null) => Promise<unknown>;
};

function composerFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('composer-flow', event, details);
}

function composerFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('composer-flow', event, details);
}

export default function useComposerSend({
  draft,
  setDraft,
  quickReplyBody,
  setQuickReplyBody,
  account,
  selectedId,
  pendingSendUndo,
  sendUndoDelaySeconds,
  setOutbox,
  setPendingSendUndo,
  setSelectedId,
  setStatus,
  showToast,
  draftInputForCurrentAccount,
  threadingForDraft,
  clearComposerAutosave,
  closeComposer,
  forceCloseComposer,
  focusMailboxRole,
  refreshAll,
  loadMeta,
}: ComposerSendOptions) {
  useEffect(() => {
    setQuickReplyBody('');
  }, [selectedId]);

  const saveDraft = useCallback(async () => {
    if (isDraftEmpty(draft)) {
      setStatus('草稿为空，未保存');
      return;
    }
    const report = await invoke<DraftSaveReport>('save_draft', {
      input: draftInputForCurrentAccount(draft),
      threading: threadingForDraft(draft),
    });
    setDraft(emptyDraft);
    clearComposerAutosave();
    forceCloseComposer();
    await refreshAll();
    setStatus(report.message);
  }, [draft, draftInputForCurrentAccount, threadingForDraft, setDraft, clearComposerAutosave, forceCloseComposer, refreshAll, setStatus]);

  const sendDraft = useCallback(async () => {
    if (!draft.to.trim()) {
      setStatus('请先填写收件人');
      return;
    }
    const subject = draft.subject.trim() || '(无主题)';
    const input = { ...draftInputForCurrentAccount(draft), draft_id: 0 };
    composerFlowLog('sendDraft start', {
      accountId: input.account_id,
      toCount: input.to.split(/[;,，；]/).filter((item) => item.trim()).length,
      subjectLength: subject.length,
      attachments: input.attachments.length,
      undoDelaySeconds: sendUndoDelaySeconds,
    });
    if (sendUndoDelaySeconds === 0) {
      try {
        const messageId = await invoke<number>('send_message', {
          input,
          threading: threadingForDraft(draft),
        });
        setDraft(emptyDraft);
        clearComposerAutosave();
        forceCloseComposer();
        await focusMailboxRole('sent', input.account_id || account?.id || null, '');
        showToast('邮件已发送');
        composerFlowLog('sendDraft done', {
          messageId,
          accountId: input.account_id,
          targetRole: 'sent',
        });
      } catch (error) {
        const message = String(error);
        closeComposer();
        await focusMailboxRole('outbox', input.account_id || account?.id || null, `发送失败，邮件已留在发件箱：${message}`);
        composerFlowWarn('sendDraft failed', {
          accountId: input.account_id,
          error: message,
          targetRole: 'outbox',
        });
      }
      return;
    }

    const expiresAt = new Date(Date.now() + sendUndoDelaySeconds * 1000).toISOString();
    const item = await invoke<OutboxItem>('queue_outbox_message', {
      input: {
        ...input,
        draft_id: 0,
        send_at: expiresAt,
      },
      threading: threadingForDraft(draft),
    });
    setOutbox((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
    setPendingSendUndo({
      outboxId: item.id,
      subject,
      expiresAt,
      delaySeconds: sendUndoDelaySeconds,
    });
    setDraft(emptyDraft);
    clearComposerAutosave();
    forceCloseComposer();
    await focusMailboxRole('outbox', item.message_id ? input.account_id || account?.id || null : null, `邮件将在 ${sendUndoDelaySeconds} 秒后发送，可立即撤回`);
    composerFlowLog('sendDraft queued', {
      outboxId: item.id,
      messageId: item.message_id,
      accountId: input.account_id,
      targetRole: 'outbox',
    });
  }, [draft, draftInputForCurrentAccount, threadingForDraft, sendUndoDelaySeconds, setDraft, clearComposerAutosave, closeComposer, forceCloseComposer, focusMailboxRole, account, setOutbox, setPendingSendUndo, setStatus, showToast]);

  const sendQuickReply = useCallback(async (message: Message) => {
    const body = quickReplyBody.trim();
    if (!body) {
      setStatus('请先填写快速回复正文');
      return;
    }
    const subject = prefixedSubject(message.subject, 'Re');
    const input = {
      draft_id: 0,
      account_id: message.account_id,
      identity_id: 0,
      to: message.sender_email,
      cc: '',
      bcc: '',
      subject,
      body: `${body}${quoteMessage(message)}`,
      html_body: '',
      send_at: '',
      attachments: [],
    };
    composerFlowLog('sendQuickReply start', {
      accountId: input.account_id,
      undoDelaySeconds: sendUndoDelaySeconds,
    });
    if (sendUndoDelaySeconds === 0) {
      try {
        const messageId = await invoke<number>('send_message', {
          input,
          threading: replyThreadingHeaders(message),
        });
        setQuickReplyBody('');
        await refreshAll();
        setSelectedId(message.id);
        showToast(`已快速回复：${message.sender_name || message.sender_email}`);
        composerFlowLog('sendQuickReply done', {
          messageId,
          accountId: message.account_id,
          targetRole: 'current',
        });
      } catch (error) {
        const errorMessage = String(error);
        setQuickReplyBody('');
        await focusMailboxRole('outbox', message.account_id, `快速回复发送失败，邮件已留在发件箱：${errorMessage}`);
        composerFlowWarn('sendQuickReply failed', {
          accountId: message.account_id,
          error: errorMessage,
          targetRole: 'outbox',
        });
      }
      return;
    }

    try {
      const expiresAt = new Date(Date.now() + sendUndoDelaySeconds * 1000).toISOString();
      const item = await invoke<OutboxItem>('queue_outbox_message', {
        input: {
          ...input,
          send_at: expiresAt,
        },
        threading: replyThreadingHeaders(message),
      });
      setOutbox((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      setPendingSendUndo({
        outboxId: item.id,
        subject,
        expiresAt,
        delaySeconds: sendUndoDelaySeconds,
      });
      setQuickReplyBody('');
      await focusMailboxRole('outbox', message.account_id, `快速回复将在 ${sendUndoDelaySeconds} 秒后发送，可立即撤回`);
      composerFlowLog('sendQuickReply queued', {
        outboxId: item.id,
        messageId: item.message_id,
        accountId: message.account_id,
        targetRole: 'outbox',
      });
    } catch (error) {
      const errorMessage = String(error);
      setQuickReplyBody('');
      await focusMailboxRole('outbox', message.account_id, `快速回复排队失败：${errorMessage}`);
      composerFlowWarn('sendQuickReply queue failed', {
        accountId: message.account_id,
        error: errorMessage,
        targetRole: 'outbox',
      });
    }
  }, [quickReplyBody, sendUndoDelaySeconds, setQuickReplyBody, refreshAll, setSelectedId, setStatus, showToast, focusMailboxRole, setOutbox, setPendingSendUndo]);

  const queueDraft = useCallback(async () => {
    if (!draft.to.trim()) {
      setStatus('请先填写收件人');
      return;
    }
    const sendAt = draft.send_at.trim();
    const input = {
      ...draftInputForCurrentAccount(draft),
      draft_id: 0,
      send_at: sendAt ? new Date(sendAt).toISOString() : '',
    };
    const item = await invoke<OutboxItem>('queue_outbox_message', {
      input,
      threading: threadingForDraft(draft),
    });
    setDraft(emptyDraft);
    clearComposerAutosave();
    forceCloseComposer();
    await focusMailboxRole('outbox', input.account_id || account?.id || null, sendAt ? `邮件已安排稍后发送：${formatDate(input.send_at)}` : '邮件已加入发件箱队列');
    composerFlowLog('queueDraft done', {
      outboxId: item.id,
      messageId: item.message_id,
      accountId: input.account_id,
      targetRole: 'outbox',
    });
  }, [draft, draftInputForCurrentAccount, threadingForDraft, setDraft, clearComposerAutosave, forceCloseComposer, focusMailboxRole, account, setStatus]);

  const cancelOutboxItem = useCallback(async (item: OutboxItem) => {
    const updated = await invoke<OutboxItem>('cancel_outbox_item', { outboxId: item.id });
    setOutbox((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    setPendingSendUndo((current) => (current?.outboxId === item.id ? null : current));
    await loadMeta();
    setStatus('已撤回到草稿箱');
  }, [setOutbox, setPendingSendUndo, loadMeta, setStatus]);

  const undoPendingSend = useCallback(async () => {
    const pending = pendingSendUndo;
    if (!pending) return;
    setPendingSendUndo(null);
    const updated = await invoke<OutboxItem>('cancel_outbox_item', { outboxId: pending.outboxId });
    setOutbox((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    await refreshAll();
    setStatus(`已撤回发送：${pending.subject}`);
  }, [pendingSendUndo, setPendingSendUndo, setOutbox, refreshAll, setStatus]);

  return {
    saveDraft,
    sendDraft,
    sendQuickReply,
    queueDraft,
    cancelOutboxItem,
    undoPendingSend,
  };
}
