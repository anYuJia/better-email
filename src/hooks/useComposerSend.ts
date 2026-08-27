import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import {
  emptyDraft,
  isDraftEmpty,
  type SendUndoDelaySeconds,
} from '../app/appConfig';
import type {
  Account,
  DraftInput,
  DraftSaveReport,
  BackgroundTask,
  FolderRole,
  Message,
  OutboxItem,
} from '../app/types';
import type { PendingSendUndo } from '../components/UndoSnackbarStack';
import { formatDate, prefixedSubject, quoteMessage, replyThreadingHeaders } from '../mailUtils';
import { flowInfo, flowWarn } from '../app/logger';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

const DIRECT_SEND_PROGRESS_POLL_INTERVAL_MS = 1000;

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
  setStatus: Dispatch<SetStateAction<string>>;
  showToast: (text: string) => void;
  draftInputForCurrentAccount: (input: DraftInput) => DraftInput;
  threadingForDraft: (input: DraftInput) => { in_reply_to: string; references: string } | null;
  clearComposerAutosave: () => void;
  forceCloseComposer: () => void;
  focusMailboxRole: (role: FolderRole, targetAccountId: number | null, statusMessage: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  loadMeta: (folderId?: number | null) => Promise<unknown>;
  setSendProgress?: (progress: number | null) => void;
  setSendProgressMessage?: (message: string | null) => void;
  setAttachmentProgress?: (progress: number | null) => void;
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
  setStatus,
  showToast,
  draftInputForCurrentAccount,
  threadingForDraft,
  clearComposerAutosave,
  forceCloseComposer,
  focusMailboxRole,
  refreshAll,
  loadMeta,
  setSendProgress,
  setSendProgressMessage,
  setAttachmentProgress,
}: ComposerSendOptions) {
  const lastSendProgressRef = useRef<number | null>(null);
  const lastSendProgressMessageRef = useRef<string | null>(null);
  const lastAttachmentProgressRef = useRef<number | null>(null);

  const reportAttachmentProgress = (progress: number | null) => {
    if (progress == null) {
      if (lastAttachmentProgressRef.current == null) return;
      lastAttachmentProgressRef.current = null;
      setAttachmentProgress?.(null);
      return;
    }
    const clamped = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
    if (clamped === lastAttachmentProgressRef.current) {
      return;
    }
    lastAttachmentProgressRef.current = clamped;
    setAttachmentProgress?.(clamped);
  };

  const attachmentProgressMessagePattern = /\u8bfb\u53d6\u9644\u4ef6|\u9644\u4ef6\u5df2\u8bfb\u53d6|\u9644\u4ef6\u8bfb\u53d6\u5b8c\u6210|\u9644\u4ef6\u6821\u9a8c\u5931\u8d25|\u65e0\u9644\u4ef6\uff0c\u76f4\u63a5\u6784\u5efa MIME/;
  const syncAttachmentProgressFromTask = (message: string | null, percent: number | null) => {
    if (!message || !attachmentProgressMessagePattern.test(message)) {
      reportAttachmentProgress(null);
      return;
    }
    reportAttachmentProgress(percent);
  };

  const reportSendProgress = (progress: number | null) => {
    if (progress == null) {
      if (lastSendProgressRef.current == null) return;
      lastSendProgressRef.current = null;
      setSendProgress?.(null);
      return;
    }
    const clamped = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
    if (clamped === lastSendProgressRef.current) {
      return;
    }
    lastSendProgressRef.current = clamped;
    setSendProgress?.(clamped);
  };

  const reportSendProgressMessage = (message: string | null) => {
    if (message == null) {
      if (lastSendProgressMessageRef.current == null) return;
      lastSendProgressMessageRef.current = null;
      setSendProgressMessage?.(null);
      return;
    }
    if (message === lastSendProgressMessageRef.current) return;
    lastSendProgressMessageRef.current = message;
    setSendProgressMessage?.(message);
  };

  useEffect(() => {
    setQuickReplyBody('');
  }, [selectedId]);

  const saveDraft = useCallback(async () => {
    if (isDraftEmpty(draft)) {
      setStatus('草稿为空，未保存');
      return;
    }
    setStatus('正在保存草稿…');
    let report: DraftSaveReport;
    try {
      report = await invoke<DraftSaveReport>(IPC.SaveDraft, {
        input: draftInputForCurrentAccount(draft),
        threading: threadingForDraft(draft),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`保存失败，邮件内容已保留：${message}`);
      throw error;
    }
    setStatus(report.message);
    setDraft(emptyDraft);
    clearComposerAutosave();
    forceCloseComposer();
    try {
      await refreshAll();
      setStatus(report.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`草稿已保存，但刷新邮件列表失败：${message}`);
    }
  }, [draft, draftInputForCurrentAccount, threadingForDraft, setDraft, clearComposerAutosave, forceCloseComposer, refreshAll, setStatus]);

  const runDirectSendWithProgress = useCallback(async (
    input: DraftInput,
    threading: { in_reply_to: string; references: string } | null,
    options: {
      taskAccountId: number | null;
      onSuccess: (messageId: number) => Promise<void> | void;
      onFailure: (errorMessage: string) => Promise<void> | void;
    },
  ) => {
    let taskId: number | null = null;
    let pollTimer = 0;

    const stopPolling = () => {
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = 0;
      }
    };

    const syncProgress = async () => {
      if (!taskId) return;
      try {
        const latest = await invoke<BackgroundTask>(IPC.GetBackgroundTask, { taskId });
        if (latest.status === 'running') {
          const percent = Number.isFinite(latest.progress) ? latest.progress : 0;
          const normalizedPercent = Math.max(0, Math.min(100, Math.round(percent)));
          const normalizedMessage = `发送中：${latest.message || '处理中'}（${normalizedPercent}%）`;
          reportSendProgress(normalizedPercent);
          reportSendProgressMessage(normalizedMessage);
          syncAttachmentProgressFromTask(latest.message, normalizedPercent);
          setStatus(normalizedMessage);
          return;
        }
        stopPolling();
        reportSendProgress(null);
        reportSendProgressMessage(null);
        reportAttachmentProgress(null);
        if (latest.message) {
          setStatus(`发送完成：${latest.message}`);
        }
      } catch {
        stopPolling();
        reportSendProgress(null);
        reportSendProgressMessage(null);
        reportAttachmentProgress(null);
      }
    };

    try {
      reportAttachmentProgress(null);
      setStatus('发送中：准备发送任务...');
      reportSendProgressMessage('发送中：准备发送任务...');
      const task = await invoke<BackgroundTask>(IPC.EnqueueBackgroundTask, {
        input: {
          kind: 'outbox-smtp',
          source: 'manual',
          account_id: options.taskAccountId,
        },
      });
      taskId = task.id;
      await invoke<BackgroundTask>(IPC.MarkBackgroundTaskRunning, { taskId });
      const initialPercent = Math.max(0, Math.min(100, Math.round(task.progress || 0)));
      const taskReadyMessage = `发送中：${task.message || '处理中'}（${initialPercent}%）`;
      reportSendProgress(initialPercent);
      syncAttachmentProgressFromTask(task.message, initialPercent);
      setStatus(taskReadyMessage);
      reportSendProgressMessage(taskReadyMessage);
      pollTimer = window.setInterval(() => {
        syncProgress().catch(() => {
          stopPolling();
        });
      }, DIRECT_SEND_PROGRESS_POLL_INTERVAL_MS);

      const messageId = await invoke<number>(IPC.SendMessage, {
        input,
        threading,
        task_id: taskId,
      });
      await invoke<BackgroundTask>(IPC.CompleteBackgroundTask, {
        taskId,
        message: '发送完成',
      });
      stopPolling();
      reportSendProgressMessage('发送完成');
      reportAttachmentProgress(null);
      await options.onSuccess(messageId);
      return;
    } catch (error) {
      const errorMessage = String(error);
      stopPolling();
      reportSendProgress(null);
      reportSendProgressMessage(null);
      reportAttachmentProgress(null);
      if (taskId) {
        try {
          const failedTask = await invoke<BackgroundTask>(IPC.FailBackgroundTask, {
            taskId,
            message: errorMessage,
          });
          if (failedTask.message) {
            setStatus(`发送失败：${failedTask.message}`);
          }
        } catch {
          setStatus(`发送失败：${errorMessage}`);
        }
      } else {
        setStatus(`发送失败：${errorMessage}`);
      }
      await options.onFailure(errorMessage);
      return;
    }
  }, [setStatus, setSendProgress, setSendProgressMessage, setAttachmentProgress]);

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
      await runDirectSendWithProgress(input, threadingForDraft(draft), {
        taskAccountId: input.account_id || account?.id || null,
        onSuccess: async (messageId) => {
          setStatus('发送完成');
          setDraft(emptyDraft);
          clearComposerAutosave();
          forceCloseComposer();
          showToast('邮件已发送');
          composerFlowLog('sendDraft done', {
            messageId,
            accountId: input.account_id,
            targetRole: 'current',
          });
        },
        onFailure: async (message) => {
          setStatus(`发送失败，邮件内容已保留，可修改后重试：${message}`);
          composerFlowWarn('sendDraft failed', {
            accountId: input.account_id,
            error: message,
            targetRole: 'current',
          });
        },
      });
      return;
    }

    const expiresAt = new Date(Date.now() + sendUndoDelaySeconds * 1000).toISOString();
    const item = await invoke<OutboxItem>(IPC.QueueOutboxMessage, {
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
    setStatus(`邮件将在 ${sendUndoDelaySeconds} 秒后发送，可立即撤回`);
    composerFlowLog('sendDraft queued', {
      outboxId: item.id,
      messageId: item.message_id,
      accountId: input.account_id,
      targetRole: 'current',
    });
  }, [draft, draftInputForCurrentAccount, threadingForDraft, sendUndoDelaySeconds, setDraft, clearComposerAutosave, forceCloseComposer, account, setOutbox, setPendingSendUndo, setStatus, showToast, runDirectSendWithProgress]);

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
      await runDirectSendWithProgress(input, replyThreadingHeaders(message), {
        taskAccountId: message.account_id,
        onSuccess: async (messageId) => {
          setQuickReplyBody('');
          setStatus('快速回复发送完成');
          showToast(`已快速回复：${message.sender_name || message.sender_email}`);
          composerFlowLog('sendQuickReply done', {
            messageId,
            accountId: message.account_id,
            targetRole: 'current',
          });
        },
        onFailure: async (errorMessage) => {
          // Keep the reply body available for correction or retry, and keep
          // the reader in place even when no visible outbox folder exists.
          setStatus(`快速回复发送失败：${errorMessage}`);
          composerFlowWarn('sendQuickReply failed', {
            accountId: message.account_id,
            error: errorMessage,
            targetRole: 'current',
          });
        },
      });
      return;
    }

    try {
      const expiresAt = new Date(Date.now() + sendUndoDelaySeconds * 1000).toISOString();
      const item = await invoke<OutboxItem>(IPC.QueueOutboxMessage, {
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
      setStatus(`快速回复将在 ${sendUndoDelaySeconds} 秒后发送，可立即撤回`);
      composerFlowLog('sendQuickReply queued', {
        outboxId: item.id,
        messageId: item.message_id,
        accountId: message.account_id,
        targetRole: 'current',
      });
    } catch (error) {
      const errorMessage = String(error);
      // Queue creation failed, so the user's text must remain editable.
      setStatus(`快速回复排队失败：${errorMessage}`);
      composerFlowWarn('sendQuickReply queue failed', {
        accountId: message.account_id,
        error: errorMessage,
        targetRole: 'current',
      });
    }
  }, [quickReplyBody, sendUndoDelaySeconds, setQuickReplyBody, setStatus, showToast, setOutbox, setPendingSendUndo, runDirectSendWithProgress]);

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
    const item = await invoke<OutboxItem>(IPC.QueueOutboxMessage, {
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
    const updated = await invoke<OutboxItem>(IPC.CancelOutboxItem, { outboxId: item.id });
    setOutbox((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    setPendingSendUndo((current) => (current?.outboxId === item.id ? null : current));
    await loadMeta();
    setStatus('已撤回到草稿箱');
  }, [setOutbox, setPendingSendUndo, loadMeta, setStatus]);

  const undoPendingSend = useCallback(async () => {
    const pending = pendingSendUndo;
    if (!pending) return;
    setPendingSendUndo(null);
    const updated = await invoke<OutboxItem>(IPC.CancelOutboxItem, { outboxId: pending.outboxId });
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
