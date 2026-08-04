import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  emptyDraft,
  isDraftEmpty,
  loadComposerAutosave,
  loadComposeTemplates,
  composeTemplatesStorageKey,
  composerAutosaveStorageKey,
  removeAppStorage,
  type SendUndoDelaySeconds,
} from '../app/appConfig';
import type {
  Account,
  AccountScope,
  Attachment,
  ComposeTemplate,
  ComposerAutosave,
  Contact,
  DraftInput,
  DraftSaveReport,
  Folder,
  FolderRole,
  MailIdentity,
  Message,
  MessageSummary,
  OutboundAttachmentInput,
  OutboxItem,
} from '../app/types';
import type { PendingSendUndo } from '../components/UndoSnackbarStack';
import {
  formatDate,
  prefixedSubject,
  quoteMessage,
  replyThreadingHeaders,
} from '../mailUtils';
import { flowInfo, flowWarn } from '../app/logger';
import { getCurrentWindow, invoke } from '../tauriBridge';
import {
  buildForwardAttachmentPlan,
  forwardAttachmentStatus,
} from '../app/forwarding';

type LoadMetaResult = {
  folderId: number | null;
  folders: Folder[];
};

type UseComposerControllerOptions = {
  account: Account | null;
  accounts: Account[];
  identities: MailIdentity[];
  selectedId: number | null;
  pendingSendUndo: PendingSendUndo | null;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
  setPendingSendUndo: Dispatch<SetStateAction<PendingSendUndo | null>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  loadMeta: (folderId?: number | null) => Promise<LoadMetaResult>;
  refreshAll: () => Promise<void>;
  focusMailboxRole: (role: FolderRole, targetAccountId: number | null, statusMessage: string) => Promise<void>;
};

function composerFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('composer-flow', event, details);
}

function composerFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('composer-flow', event, details);
}

export default function useComposerController({
  account,
  accounts,
  identities,
  selectedId,
  pendingSendUndo,
  sendUndoDelaySeconds,
  setOutbox,
  setPendingSendUndo,
  setSelectedId,
  setStatus,
  loadMeta,
  refreshAll,
  focusMailboxRole,
}: UseComposerControllerOptions) {
  const [draft, setDraft] = useState<DraftInput>(emptyDraft);
  const [quickReplyBody, setQuickReplyBody] = useState('');
  const [isRichComposer, setRichComposer] = useState(false);
  const [composeTemplates, setComposeTemplates] = useState<ComposeTemplate[]>(loadComposeTemplates);
  const [templateName, setTemplateName] = useState('');
  const [composerAutosave, setComposerAutosave] = useState<ComposerAutosave | null>(loadComposerAutosave);
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [isComposerMinimized, setComposerMinimized] = useState(false);
  const [isComposerDropActive, setComposerDropActive] = useState(false);
  const [composerCloseConfirmOpen, setComposerCloseConfirmOpen] = useState(false);

  const openComposer = useCallback((nextDraft?: DraftInput, options: { restoreAutosave?: boolean } = {}) => {
    if (nextDraft) {
      setDraft(nextDraft);
    } else if (options.restoreAutosave && isDraftEmpty(draft) && composerAutosave) {
      setDraft(composerAutosave.draft);
      setRichComposer(composerAutosave.isRichComposer);
      setStatus(`已恢复自动保存草稿：${formatDate(composerAutosave.saved_at)}`);
    }
    setComposerMinimized(false);
    setComposerOpen(true);
  }, [draft, composerAutosave, setStatus]);

  function composeToContact(contact: Contact) {
    openComposer({
      ...emptyDraft,
      account_id: account?.id ?? 0,
      to: contact.email,
    });
    setStatus(`正在给 ${contact.name || contact.email} 写邮件`);
  }

  function closeComposer() {
    if (!isDraftEmpty(draft)) {
      setComposerCloseConfirmOpen(true);
      return;
    }
    setComposerOpen(false);
    setComposerMinimized(false);
  }

  function forceCloseComposer() {
    setComposerOpen(false);
    setComposerMinimized(false);
    setComposerCloseConfirmOpen(false);
  }

  function clearComposerAutosave() {
    removeAppStorage(composerAutosaveStorageKey);
    setComposerAutosave(null);
  }

  function draftInputForCurrentAccount(input: DraftInput): DraftInput {
    const resolvedAccountId = input.account_id || account?.id || accounts[0]?.id || 0;
    const resolvedIdentity = identityForDraft({ ...input, account_id: resolvedAccountId });
    return {
      ...input,
      account_id: resolvedAccountId,
      identity_id: input.identity_id || resolvedIdentity?.id || 0,
    };
  }

  function threadingForDraft(input: DraftInput) {
    const inReplyTo = input.in_reply_to?.trim() ?? '';
    const references = input.references?.trim() ?? '';
    return inReplyTo || references
      ? { in_reply_to: inReplyTo, references }
      : null;
  }

  function accountForDraft(input: DraftInput = draft): Account | null {
    const accountId = input.account_id || account?.id || accounts[0]?.id || 0;
    return accounts.find((entry) => entry.id === accountId) ?? account ?? accounts[0] ?? null;
  }

  function identitiesForDraftAccount(input: DraftInput = draft): MailIdentity[] {
    const accountId = input.account_id || account?.id || accounts[0]?.id || 0;
    return identities.filter((identity) => identity.account_id === accountId);
  }

  function identityForDraft(input: DraftInput = draft): MailIdentity | null {
    const draftIdentities = identitiesForDraftAccount(input);
    return (
      draftIdentities.find((identity) => identity.id === input.identity_id) ??
      draftIdentities.find((identity) => identity.is_default) ??
      draftIdentities[0] ??
      null
    );
  }

  function insertSignatureIntoDraft() {
    const signature = identityForDraft()?.signature.trim() || accountForDraft()?.signature.trim() || '';
    if (!signature) {
      setStatus('当前发件身份未设置签名');
      return;
    }
    if (draft.body.includes(signature)) {
      setStatus('签名已在正文中');
      return;
    }
    setDraft((current) => ({
      ...current,
      body: current.body.trimEnd() ? `${current.body.trimEnd()}\n\n${signature}` : signature,
      html_body: current.html_body.trim()
        ? `${current.html_body}<br><br>${signature.replace(/\n/g, '<br>')}`
        : current.html_body,
    }));
    setStatus('已插入当前发件身份签名');
  }

  function applyComposeTemplate(template: ComposeTemplate) {
    setDraft((current) => ({
      ...current,
      subject: template.subject,
      body: template.body,
      html_body: template.html_body,
    }));
    if (template.html_body.trim()) {
      setRichComposer(true);
    }
    setStatus(`已插入模板：${template.name}`);
  }

  function saveDraftAsTemplate() {
    const hasContent = draft.subject.trim() || draft.body.trim() || draft.html_body.trim();
    if (!hasContent) {
      setStatus('请先填写主题或正文后再保存模板');
      return;
    }
    const name = templateName.trim() || draft.subject.trim() || '未命名模板';
    const nextTemplate: ComposeTemplate = {
      id: crypto.randomUUID(),
      name,
      subject: draft.subject,
      body: draft.body,
      html_body: draft.html_body,
    };
    setComposeTemplates((current) => [nextTemplate, ...current.filter((item) => item.name !== name)].slice(0, 12));
    setTemplateName('');
    setStatus(`模板已保存：${name}`);
  }

  function deleteComposeTemplate(template: ComposeTemplate) {
    setComposeTemplates((current) => current.filter((item) => item.id !== template.id));
    setStatus(`模板已删除：${template.name}`);
  }

  useEffect(() => {
    window.localStorage.setItem(composeTemplatesStorageKey, JSON.stringify(composeTemplates));
  }, [composeTemplates]);

  useEffect(() => {
    if (!isComposerOpen || isDraftEmpty(draft)) return;
    const autosave: ComposerAutosave = {
      draft,
      isRichComposer,
      saved_at: new Date().toISOString(),
    };
    window.localStorage.setItem(composerAutosaveStorageKey, JSON.stringify(autosave));
    setComposerAutosave(autosave);
  }, [draft, isRichComposer, isComposerOpen]);

  useEffect(() => {
    if (!isComposerOpen) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;

    getCurrentWindow().onDragDropEvent(async (event) => {
      if (!active) return;
      if (event.type === 'enter' || event.type === 'over') {
        setComposerDropActive(true);
        return;
      }
      if (event.type === 'leave') {
        setComposerDropActive(false);
        return;
      }
      setComposerDropActive(false);
      const paths = event.paths.filter((path) => path.trim());
      if (paths.length === 0) {
        setStatus('拖拽内容中没有文件');
        return;
      }
      try {
        const newAttachments = await invoke<OutboundAttachmentInput[]>('outbound_attachments_from_paths', { paths });
        addDraftAttachments(newAttachments, '已拖入附件');
      } catch (error) {
        setStatus(`附件拖入失败：${String(error)}`);
      }
    })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        setStatus(`附件拖拽不可用：${String(error)}`);
      });

    return () => {
      active = false;
      setComposerDropActive(false);
      unlisten?.();
    };
  }, [isComposerOpen]);

  useEffect(() => {
    setQuickReplyBody('');
  }, [selectedId]);

  function addDraftAttachments(newAttachments: OutboundAttachmentInput[], statusPrefix = '已添加附件') {
    const validAttachments = newAttachments.filter((attachment) => attachment.filename.trim());
    if (validAttachments.length === 0) {
      setStatus('没有可添加的附件');
      return;
    }
    setDraft((current) => ({
      ...current,
      attachments: [...current.attachments, ...validAttachments],
    }));
    setStatus(`${statusPrefix} ${validAttachments.length} 个`);
  }

  async function pickDraftAttachments() {
    const newAttachments = await invoke<OutboundAttachmentInput[]>('pick_outbound_attachments');
    if (newAttachments.length === 0) {
      setStatus('已取消选择附件');
      return;
    }
    addDraftAttachments(newAttachments, '已添加附件');
  }

  async function processDroppedOrPastedFiles(files: FileList, statusPrefix = '已添加附件') {
    const validFiles = Array.from(files).filter((file) => file.name.trim());
    if (validFiles.length === 0) return;

    setStatus('正在导入附件...');
    try {
      const savedAttachments: OutboundAttachmentInput[] = [];
      for (const file of validFiles) {
        // Read file bytes as base64
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1] || '';
            resolve(base64);
          };
          reader.onerror = () => reject(new Error('读取文件失败'));
          reader.readAsDataURL(file);
        });

        // Call backend to save
        const savedPath = await invoke<string>('save_temp_attachment', {
          filename: file.name,
          base64Data,
        });

        savedAttachments.push({
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: Math.min(file.size, Number.MAX_SAFE_INTEGER),
          local_path: savedPath,
        });
      }

      setDraft((current) => ({
        ...current,
        attachments: [...current.attachments, ...savedAttachments],
      }));
      setStatus(`${statusPrefix} ${savedAttachments.length} 个`);
    } catch (error) {
      console.error(error);
      setStatus(`添加附件失败: ${String(error)}`);
    }
  }

  function handleComposerAttachmentDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setComposerDropActive(false);
    const files = event.dataTransfer.files;
    if (!files || files.length === 0) {
      setStatus('拖拽内容中没有文件');
      return;
    }
    void processDroppedOrPastedFiles(files, '已拖入附件');
  }

  function handleComposerAttachmentPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void processDroppedOrPastedFiles(files, '已粘贴附件');
  }

  function handleComposerAttachmentDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleComposerAttachmentDragEnter(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setComposerDropActive(true);
  }

  function handleComposerAttachmentDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setComposerDropActive(false);
    }
  }

  function removeDraftAttachment(index: number) {
    setDraft((current) => ({
      ...current,
      attachments: current.attachments.filter((_, currentIndex) => currentIndex !== index),
    }));
    setStatus('已移除附件');
  }

  function addContactToDraft(contact: Contact, field: 'to' | 'cc' | 'bcc' = 'to') {
    const existing = draft[field]
      .split(/[;,]/)
      .map((recipient) => recipient.trim())
      .filter(Boolean);
    const contactAddresses = [contact.email, ...(contact.aliases ?? [])].map((item) => item.trim().toLowerCase()).filter(Boolean);
    if (existing.some((recipient) => contactAddresses.includes(recipient.toLowerCase()))) {
      setStatus(`联系人已在${field === 'to' ? '收件人' : field === 'cc' ? '抄送' : '密送'}中：${contact.email}`);
      return;
    }
    const nextRecipients = [...existing, contact.email].join(', ');
    setDraft((current) => ({ ...current, [field]: nextRecipients }));
    setStatus(`已添加联系人：${contact.name || contact.email}`);
  }

  async function saveDraft() {
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
  }

  async function sendDraft() {
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
        await focusMailboxRole('sent', input.account_id || account?.id || null, '邮件已发送并进入已发送');
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
  }

  async function sendQuickReply(message: Message) {
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
        setStatus(`已快速回复：${message.sender_name || message.sender_email}`);
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
  }

  async function queueDraft() {
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
  }

  async function cancelOutboxItem(item: OutboxItem) {
    const updated = await invoke<OutboxItem>('cancel_outbox_item', { outboxId: item.id });
    setOutbox((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    setPendingSendUndo((current) => (current?.outboxId === item.id ? null : current));
    await loadMeta();
    setStatus('已撤回到草稿箱');
  }

  async function undoPendingSend() {
    const pending = pendingSendUndo;
    if (!pending) return;
    setPendingSendUndo(null);
    const updated = await invoke<OutboxItem>('cancel_outbox_item', { outboxId: pending.outboxId });
    setOutbox((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    await refreshAll();
    setStatus(`已撤回发送：${pending.subject}`);
  }

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

  async function editDraftMessage(message: Message) {
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
      })),
    });
    setStatus('已打开草稿继续编辑');
  }

  return {
    draft,
    setDraft,
    quickReplyBody,
    setQuickReplyBody,
    isRichComposer,
    setRichComposer,
    composeTemplates,
    setComposeTemplates,
    templateName,
    setTemplateName,
    composerAutosave,
    setComposerAutosave,
    isComposerOpen,
    setComposerOpen,
    isComposerMinimized,
    setComposerMinimized,
    isComposerDropActive,
    setComposerDropActive,
    composerCloseConfirmOpen,
    setComposerCloseConfirmOpen,
    openComposer,
    closeComposer,
    forceCloseComposer,
    clearComposerAutosave,
    draftInputForCurrentAccount,
    threadingForDraft,
    accountForDraft,
    identitiesForDraftAccount,
    identityForDraft,
    insertSignatureIntoDraft,
    applyComposeTemplate,
    saveDraftAsTemplate,
    deleteComposeTemplate,
    addDraftAttachments,
    pickDraftAttachments,
    processDroppedOrPastedFiles,
    handleComposerAttachmentDrop,
    handleComposerAttachmentPaste,
    handleComposerAttachmentDragOver,
    handleComposerAttachmentDragEnter,
    handleComposerAttachmentDragLeave,
    removeDraftAttachment,
    addContactToDraft,
    composeFromMessage,
    editDraftMessage,
    saveDraft,
    sendDraft,
    sendQuickReply,
    queueDraft,
    cancelOutboxItem,
    undoPendingSend,
    composeToContact,
  };
}
