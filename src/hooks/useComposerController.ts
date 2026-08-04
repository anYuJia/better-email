import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  emptyDraft,
  isDraftEmpty,
  loadComposerAutosave,
  composerAutosaveStorageKey,
  removeAppStorage,
  type SendUndoDelaySeconds,
} from '../app/appConfig';
import {
  analyzeCrossAccountRisks,
  type CrossAccountRiskItem,
} from '../app/crossAccountRisk';
import type {
  Account,
  AccountScope,
  Attachment,
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
import { invoke } from '../tauriBridge';

import {
  accountForDraft,
  draftInputForCurrentAccount,
  identityForDraft,
  threadingForDraft,
} from '../app/composerDraftHelpers';
import useComposeFromMessage from './useComposeFromMessage';
import useComposerSend from './useComposerSend';
import useComposerTemplates from './useComposerTemplates';
import useComposerAttachments from './useComposerAttachments';


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
  const [composerAutosave, setComposerAutosave] = useState<ComposerAutosave | null>(loadComposerAutosave);
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [isComposerMinimized, setComposerMinimized] = useState(false);
  const [composerCloseConfirmOpen, setComposerCloseConfirmOpen] = useState(false);
  const [composerContextAccountId, setComposerContextAccountId] = useState<number | null>(null);
  const [sendRiskConfirm, setSendRiskConfirm] = useState<CrossAccountRiskItem[] | null>(null);
  const {
    composeTemplates,
    setComposeTemplates,
    templateName,
    setTemplateName,
    applyComposeTemplate,
    saveDraftAsTemplate,
    deleteComposeTemplate,
  } = useComposerTemplates({ draft, setDraft, setRichComposer, setStatus });

  const onAttachmentsReady = useCallback((
    newAttachments: OutboundAttachmentInput[],
    statusPrefix = '已添加附件',
  ) => {
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
  }, [setStatus]);

  const {
    isComposerDropActive,
    pickDraftAttachments,
    processDroppedOrPastedFiles,
    handleComposerAttachmentDrop,
    handleComposerAttachmentPaste,
    handleComposerAttachmentDragOver,
    handleComposerAttachmentDragEnter,
    handleComposerAttachmentDragLeave,
  } = useComposerAttachments({
    isComposerOpen,
    setStatus,
    onAttachmentsReady,
  });

  const {
    saveDraft,
    sendDraft,
    sendQuickReply,
    queueDraft,
    cancelOutboxItem,
    undoPendingSend,
  } = useComposerSend({
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
    draftInputForCurrentAccount,
    threadingForDraft,
    clearComposerAutosave,
    closeComposer,
    forceCloseComposer,
    focusMailboxRole,
    refreshAll,
    loadMeta,
  });

  const openComposer = useCallback((nextDraft?: DraftInput, options: { restoreAutosave?: boolean } = {}) => {
    setComposerContextAccountId(null);
    setSendRiskConfirm(null);
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
  const {
    composeFromMessage: rawComposeFromMessage,
    editDraftMessage: rawEditDraftMessage,
  } = useComposeFromMessage({
    account,
    openComposer,
    setStatus,
  });
  const composeFromMessage = useCallback(async (message: MessageSummary, mode: 'reply' | 'replyAll' | 'forward') => {
    await rawComposeFromMessage(message, mode);
    setComposerContextAccountId(message.account_id);
    setSendRiskConfirm(null);
  }, [rawComposeFromMessage]);
  const editDraftMessage = useCallback(async (message: Message) => {
    await rawEditDraftMessage(message);
    setComposerContextAccountId(message.account_id);
    setSendRiskConfirm(null);
  }, [rawEditDraftMessage]);

  const crossAccountRisks = useMemo(
    () => analyzeCrossAccountRisks(draft, accounts, {
      originalMessageAccountId: composerContextAccountId,
      contextAccountId: null,
    }),
    [draft, accounts, composerContextAccountId],
  );

  const requestSend = useCallback(async () => {
    const risks = analyzeCrossAccountRisks(draft, accounts, {
      originalMessageAccountId: composerContextAccountId,
      contextAccountId: null,
    });
    if (risks.length > 0) {
      setSendRiskConfirm(risks);
      return;
    }
    await sendDraft();
  }, [draft, accounts, composerContextAccountId, sendDraft]);

  const confirmSendRisk = useCallback(async () => {
    setSendRiskConfirm(null);
    await sendDraft();
  }, [sendDraft]);


  function composeToContact(contact: Contact) {
    openComposer({
      ...emptyDraft,
      account_id: account?.id ?? 0,
      to: contact.email,
    });
    setStatus(`正在给 ${contact.name || contact.email} 写邮件`);
  }  function closeComposer() {
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
    composerCloseConfirmOpen,
    setComposerCloseConfirmOpen,
    openComposer,
    closeComposer,
    forceCloseComposer,
    clearComposerAutosave,
    draftInputForCurrentAccount,
    threadingForDraft,
    accountForDraft,
    identityForDraft,
    insertSignatureIntoDraft,
    applyComposeTemplate,
    saveDraftAsTemplate,
    deleteComposeTemplate,
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
    requestSend,
    confirmSendRisk,
    sendRiskConfirm,
    setSendRiskConfirm,
    crossAccountRisks,
    composerContextAccountId,
    sendQuickReply,
    queueDraft,
    cancelOutboxItem,
    undoPendingSend,
    composeToContact,
  };
}
