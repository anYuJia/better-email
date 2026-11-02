import {
  useCallback,
  useState,
  useRef,
  useEffect,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from 'react';
import {
  isDraftEmpty,
  type SendUndoDelaySeconds,
} from '../app/appConfig';
import type {
  Account,
  DraftInput,
  DraftSaveReport,
  ComposerSaveResult,
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
import type { QuickReplySnapshot } from './useQuickReplyDraft';

const DIRECT_SEND_PROGRESS_POLL_INTERVAL_MS = 1000;

export type ComposerSendIssue = {
  kind: 'failed' | 'uncertain';
  message: string;
};

type ComposerSendOptions = {
  getDraftSnapshot: () => { draft: DraftInput; revision: number };
  clearSubmittedDraft: (revision: number) => boolean;
  getQuickReplySnapshot: () => QuickReplySnapshot;
  clearSubmittedQuickReply: (snapshot: QuickReplySnapshot) => void;
  submissionInFlight: MutableRefObject<boolean>;
  getAttachmentSendBlockReason?: () => string | null;
  beforeSubmitDraft?: (draft: DraftInput) => Promise<void>;
  account: Account | null;
  pendingSendUndo: PendingSendUndo | null;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
  setPendingSendUndo: Dispatch<SetStateAction<PendingSendUndo | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  showToast: (text: string) => void;
  draftInputForCurrentAccount: (input: DraftInput) => DraftInput;
  threadingForDraft: (input: DraftInput) => { in_reply_to: string; references: string } | null;
  focusMailboxRole: (role: FolderRole, targetAccountId: number | null, statusMessage: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshContacts?: () => Promise<unknown>;
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
  getDraftSnapshot,
  clearSubmittedDraft,
  getQuickReplySnapshot,
  clearSubmittedQuickReply,
  submissionInFlight,
  getAttachmentSendBlockReason,
  beforeSubmitDraft,
  account,
  pendingSendUndo,
  sendUndoDelaySeconds,
  setOutbox,
  setPendingSendUndo,
  setStatus,
  showToast,
  draftInputForCurrentAccount,
  threadingForDraft,
  focusMailboxRole,
  refreshAll,
  refreshContacts,
  loadMeta,
  setSendProgress,
  setSendProgressMessage,
  setAttachmentProgress,
}: ComposerSendOptions) {
  const [submissionKind, setSubmissionKind] = useState<'save' | 'send' | 'queue' | 'quick-reply' | null>(null);
  const [sendIssue, setSendIssue] = useState<ComposerSendIssue | null>(null);
  const uncertainSendRef = useRef(false);
  const uncertainQuickRepliesRef = useRef(new Set<string>());
  const stopActivePollingRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopActivePollingRef.current?.(), []);
  const resetSendIssue = useCallback(() => {
    uncertainSendRef.current = false;
    setSendIssue(null);
  }, []);
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

  const saveDraft = useCallback(async (): Promise<ComposerSaveResult> => {
    const { draft, revision } = getDraftSnapshot();
    if (isDraftEmpty(draft)) {
      const message = '草稿为空，未保存';
      setStatus(message);
      return { status: 'empty', message };
    }
    setStatus('正在保存草稿…');
    let report: DraftSaveReport;
    try {
      report = await invoke<DraftSaveReport>(IPC.SaveDraft, {
        input: draftInputForCurrentAccount(draft),
        threading: threadingForDraft(draft),
      });
      if (draft.quick_reply_source && (!Number.isInteger(report?.draft_id) || report.draft_id <= 0)) {
        throw new Error('服务器未返回已保存的草稿编号，回复内容仍保留，请确认后重试');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`保存失败，邮件内容已保留：${message}`);
      throw error;
    }
    if (draft.quick_reply_source) clearSubmittedQuickReply(draft.quick_reply_source);
    const cleared = clearSubmittedDraft(revision);
    const completedStatus = cleared ? report.message : `${report.message}；新增编辑已保留在写信窗口`;
    setStatus(completedStatus);
    try {
      await refreshAll();
      setStatus(completedStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`草稿已保存，但刷新邮件列表失败：${message}`);
    }
    return { status: 'saved' };
  }, [getDraftSnapshot, clearSubmittedDraft, clearSubmittedQuickReply, draftInputForCurrentAccount, threadingForDraft, refreshAll, setStatus]);

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
    let stopped = false;
    let polling = false;
    let acceptedMessageId: number | null = null;

    const stopPolling = () => {
      stopped = true;
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = 0;
      }
    };
    stopActivePollingRef.current = stopPolling;

    const syncProgress = async () => {
      if (!taskId || stopped || polling) return;
      polling = true;
      try {
        const latest = await invoke<BackgroundTask>(IPC.GetBackgroundTask, { taskId });
        if (stopped) return;
        if (latest.status === 'running') {
          const percent = Number.isFinite(latest.progress) ? latest.progress : 0;
          const normalizedPercent = Math.max(0, Math.min(100, Math.round(percent)));
          // This percentage describes workflow stages, not bytes uploaded over
          // SMTP. A server acknowledgement is the only delivery success signal.
          const normalizedMessage = latest.message || '正在发送，等待服务器确认';
          reportSendProgress(normalizedPercent);
          reportSendProgressMessage(normalizedMessage);
          syncAttachmentProgressFromTask(latest.message, normalizedPercent);
          setStatus(normalizedMessage);
          return;
        }
        // The command promise owns completion. A task may finish just before
        // its result arrives; keep the composer locked and its status visible.
        if (latest.message) reportSendProgressMessage(latest.message);
      } catch {
        if (!stopped) reportSendProgressMessage('正在发送，进度更新暂时中断；请等待发送结果');
      } finally {
        polling = false;
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
      const taskReadyMessage = task.message || '准备发送任务…';
      reportSendProgress(initialPercent);
      syncAttachmentProgressFromTask(task.message, initialPercent);
      setStatus(taskReadyMessage);
      reportSendProgressMessage(taskReadyMessage);
      pollTimer = window.setInterval(() => {
        void syncProgress();
      }, DIRECT_SEND_PROGRESS_POLL_INTERVAL_MS);

      const messageId = await invoke<number>(IPC.SendMessage, {
        input,
        threading,
        taskId,
      });
      acceptedMessageId = messageId;
      stopPolling();
      try {
        await invoke<BackgroundTask>(IPC.CompleteBackgroundTask, { taskId, message: '发送完成' });
      } catch (error) {
        composerFlowWarn('sent; progress completion failed', { messageId, error: String(error) });
      }
      reportSendProgressMessage('发送完成');
      reportAttachmentProgress(null);
      await options.onSuccess(messageId);
      reportSendProgress(null);
      reportSendProgressMessage(null);
      return;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error).replace(/^Error:\s*/i, '');
      stopPolling();
      if (acceptedMessageId !== null) {
        reportSendProgress(null);
        reportSendProgressMessage(null);
        reportAttachmentProgress(null);
        const detail = `邮件已发送，请勿重发。请在主窗口核对已发送文件夹；界面更新失败：${errorMessage}`;
        setStatus(detail);
        uncertainSendRef.current = true;
        setSendIssue({ kind: 'uncertain', message: detail });
        composerFlowWarn('sent; UI completion failed', { messageId: acceptedMessageId, error: errorMessage });
        return;
      }
      reportSendProgress(null);
      reportSendProgressMessage(null);
      reportAttachmentProgress(null);
      if (taskId) {
        try {
          await invoke<BackgroundTask>(IPC.FailBackgroundTask, {
            taskId,
            message: errorMessage,
          });
        } catch {
          composerFlowWarn('failed to update send task', { taskId, error: errorMessage });
        }
      }
      try {
        setOutbox(await invoke<OutboxItem[]>(IPC.ListOutbox));
      } catch {
        composerFlowWarn('failed to refresh outbox after send error');
      }
      await options.onFailure(errorMessage);
      return;
    }
  }, [setStatus, setOutbox, setSendProgress, setSendProgressMessage, setAttachmentProgress]);

  const sendDraft = useCallback(async () => {
    const { draft, revision } = getDraftSnapshot();
    if (!draft.to.trim()) {
      setStatus('请先填写收件人');
      return;
    }
    const subject = draft.subject.trim() || '(无主题)';
    const input = { ...draftInputForCurrentAccount(draft), draft_id: 0 };
    // Persist recovery references before the backend promotes attachment paths.
    // A concurrent temp cleanup must not break retry of the retained draft.
    await beforeSubmitDraft?.(draftInputForCurrentAccount(draft));
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
          if (draft.quick_reply_source) clearSubmittedQuickReply(draft.quick_reply_source);
          const cleared = clearSubmittedDraft(revision);
          setStatus(cleared ? '发送完成' : '邮件已发送，新增编辑已保留在写信窗口');
          showToast('邮件已发送');
          try {
            await refreshContacts?.();
          } catch (error) {
            composerFlowWarn('refresh contacts after send failed', {
              error: String(error),
              messageId,
            });
          }
          composerFlowLog('sendDraft done', {
            messageId,
            accountId: input.account_id,
            targetRole: 'current',
          });
        },
        onFailure: async (message) => {
          const uncertain = message.includes('[SEND_OUTCOME_UNKNOWN]');
          const detail = uncertain
            ? '邮件内容已保留。请先在主窗口核对已发送文件夹，再到发件箱确认结果；不要直接重发。'
            : `正文和附件已保留。${message}`;
          uncertainSendRef.current = uncertain;
          setSendIssue({ kind: uncertain ? 'uncertain' : 'failed', message: detail });
          setStatus(detail);
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
    if (draft.quick_reply_source) clearSubmittedQuickReply(draft.quick_reply_source);
    const cleared = clearSubmittedDraft(revision);
    setStatus(`邮件将在 ${sendUndoDelaySeconds} 秒后发送，可立即撤回${cleared ? '' : '；新增编辑已保留在写信窗口'}`);
    composerFlowLog('sendDraft queued', {
      outboxId: item.id,
      messageId: item.message_id,
      accountId: input.account_id,
      targetRole: 'current',
    });
  }, [getDraftSnapshot, clearSubmittedDraft, clearSubmittedQuickReply, draftInputForCurrentAccount, threadingForDraft, sendUndoDelaySeconds, account, setOutbox, setPendingSendUndo, setStatus, showToast, refreshContacts, runDirectSendWithProgress, beforeSubmitDraft]);

  const sendQuickReply = useCallback(async (message: Message) => {
    const snapshot = getQuickReplySnapshot();
    if (snapshot.key !== `${message.account_id}:${message.id}`) {
      setStatus('邮件已切换，快速回复未提交。请确认当前邮件后重试。');
      return;
    }
    if (uncertainQuickRepliesRef.current.has(snapshot.key)) {
      setStatus('这封邮件的快速回复发送结果未确认，请先在发件箱核对并处理，不要直接重发。');
      return;
    }
    const body = snapshot.body.trim();
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
          setStatus('快速回复发送完成');
          clearSubmittedQuickReply(snapshot);
          showToast(`已快速回复：${message.sender_name || message.sender_email}`);
          try {
            await refreshContacts?.();
          } catch (error) {
            composerFlowWarn('refresh contacts after quick reply failed', {
              error: String(error),
              messageId,
            });
          }
          composerFlowLog('sendQuickReply done', {
            messageId,
            accountId: message.account_id,
            targetRole: 'current',
          });
        },
        onFailure: async (errorMessage) => {
          // Keep the reply body available for correction or retry, and keep
          // the reader in place even when no visible outbox folder exists.
          const uncertain = errorMessage.includes('[SEND_OUTCOME_UNKNOWN]');
          if (uncertain) uncertainQuickRepliesRef.current.add(snapshot.key);
          setStatus(uncertain
            ? '快速回复的发送结果未确认，正文已保留。请先核对已发送文件夹，并在发件箱确认结果；不要直接重发。'
            : `快速回复发送失败：${errorMessage}`);
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
      setStatus(`快速回复将在 ${sendUndoDelaySeconds} 秒后发送，可立即撤回`);
      clearSubmittedQuickReply(snapshot);
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
  }, [getQuickReplySnapshot, clearSubmittedQuickReply, sendUndoDelaySeconds, setStatus, showToast, refreshContacts, setOutbox, setPendingSendUndo, runDirectSendWithProgress]);

  const queueDraft = useCallback(async () => {
    const { draft, revision } = getDraftSnapshot();
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
    await beforeSubmitDraft?.(draftInputForCurrentAccount(draft));
    const item = await invoke<OutboxItem>(IPC.QueueOutboxMessage, {
      input,
      threading: threadingForDraft(draft),
    });
    if (draft.quick_reply_source) clearSubmittedQuickReply(draft.quick_reply_source);
    const cleared = clearSubmittedDraft(revision);
    const completedStatus = (sendAt ? `邮件已安排稍后发送：${formatDate(input.send_at)}` : '邮件已加入发件箱队列')
      + (cleared ? '' : '；新增编辑已保留在写信窗口');
    try {
      await focusMailboxRole('outbox', input.account_id || account?.id || null, completedStatus);
    } catch (error) {
      setStatus(`${completedStatus}；列表刷新失败，请勿重复提交：${String(error)}`);
    }
    composerFlowLog('queueDraft done', {
      outboxId: item.id,
      messageId: item.message_id,
      accountId: input.account_id,
      targetRole: 'outbox',
    });
  }, [getDraftSnapshot, clearSubmittedDraft, clearSubmittedQuickReply, draftInputForCurrentAccount, threadingForDraft, focusMailboxRole, account, setStatus, beforeSubmitDraft]);

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

  const submitOnce = useCallback(async <T,>(kind: NonNullable<typeof submissionKind>, submit: () => Promise<T>): Promise<
    { executed: true; value: T } | { executed: false; message: string }
  > => {
    if (submissionInFlight.current) return { executed: false, message: '正在提交邮件，请等待完成后再操作。' };
    if (kind !== 'quick-reply') {
      const blocked = getAttachmentSendBlockReason?.();
      if (blocked) {
        setStatus(blocked);
        return { executed: false, message: blocked };
      }
      if (kind !== 'save' && uncertainSendRef.current) {
        const message = '发送结果未确认，请先在主窗口的发件箱核对结果，不要直接重发。';
        setStatus(message);
        return { executed: false, message };
      }
      if (kind !== 'save') setSendIssue(null);
    }
    submissionInFlight.current = true;
    setSubmissionKind(kind);
    try {
      return { executed: true, value: await submit() };
    } catch (error) {
      if (kind === 'send' || kind === 'queue') {
        const detail = error instanceof Error ? error.message : String(error).replace(/^Error:\s*/i, '');
        const message = `提交失败，正文和附件已保留：${detail}`;
        setSendIssue({ kind: 'failed', message });
        setStatus(message);
      }
      throw error;
    } finally {
      submissionInFlight.current = false;
      setSubmissionKind(null);
    }
  }, [submissionInFlight, getAttachmentSendBlockReason, setStatus]);
  const guardedSaveDraft = useCallback(async (): Promise<ComposerSaveResult> => {
    const result = await submitOnce('save', saveDraft);
    return result.executed ? result.value : { status: 'blocked', message: result.message };
  }, [saveDraft, submitOnce]);
  const guardedSendDraft = useCallback(async () => { await submitOnce('send', sendDraft); }, [sendDraft, submitOnce]);
  const guardedQueueDraft = useCallback(async () => { await submitOnce('queue', queueDraft); }, [queueDraft, submitOnce]);
  const guardedQuickReply = useCallback(async (message: Message) => { await submitOnce('quick-reply', () => sendQuickReply(message)); }, [sendQuickReply, submitOnce]);

  return {
    isSubmitting: submissionKind !== null,
    submissionKind,
    sendIssue,
    resetSendIssue,
    saveDraft: guardedSaveDraft,
    sendDraft: guardedSendDraft,
    sendQuickReply: guardedQuickReply,
    queueDraft: guardedQueueDraft,
    cancelOutboxItem,
    undoPendingSend,
  };
}
