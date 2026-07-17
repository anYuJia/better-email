import { type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import type {
  Message,
  MessageSummary,
  ThreadSummary,
  Attachment,
  AttachmentDownload,
  RemoteImageTrust,
  MailRule,
  SystemFolderRole,
} from '../app/types';
import { invoke } from '../tauriBridge';
import { remoteImageTrustInput } from '../mailUtils';
import { flowInfo, flowWarn } from '../app/logger';

function appFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('app-flow', event, details);
}

function appFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('app-flow', event, details);
}

function toSummary(msg: Message): MessageSummary {
  const { body, sanitized_html, ...rest } = msg;
  return rest;
}

type UseReaderActionsOptions = {
  selected: MessageSummary | null;
  selectedDetail: Message | null;
  setSelectedDetail: Dispatch<SetStateAction<Message | null>>;
  onUpdateCache: (message: Message) => void;
  activeThread: ThreadSummary | null;
  folderId: number | null;
  setMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setThreadMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setRemoteImageTrusts: Dispatch<SetStateAction<RemoteImageTrust[]>>;
  setRules: Dispatch<SetStateAction<MailRule[]>>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  visibleFolderIdForRole: (role: SystemFolderRole, accountId: number) => number | null;
  loadMeta: (folderId: number | null) => Promise<any>;
  loadMessages: (folderId: number | null) => Promise<any>;
  bodyFetchFailedRef: MutableRefObject<Set<number>>;
  bodyFetchInFlightRef: MutableRefObject<Set<number>>;
};

export default function useReaderActions({
  selected,
  selectedDetail,
  setSelectedDetail,
  onUpdateCache,
  activeThread,
  folderId,
  setMessages,
  setThreadMessages,
  setAttachments,
  setRemoteImageTrusts,
  setRules,
  setSelectedId,
  setStatus,
  visibleFolderIdForRole,
  loadMeta,
  loadMessages,
  bodyFetchFailedRef,
  bodyFetchInFlightRef,
}: UseReaderActionsOptions) {

  async function renderSelectedWithRemoteImagePolicy(messageId = selected?.id) {
    if (!messageId) return null;
    const updated = await invoke<Message>('render_message_with_remote_image_policy', { messageId });
    const summary = toSummary(updated);
    setMessages((current) => current.map((message) => (message.id === summary.id ? summary : message)));
    if (activeThread) {
      setThreadMessages((current) => current.map((message) => (message.id === summary.id ? summary : message)));
    }
    if (selectedDetail && selectedDetail.id === updated.id) {
      setSelectedDetail(updated);
    }
    onUpdateCache(updated);
    return updated;
  }

  async function fetchSelectedBody(isSilent = false) {
    if (!selected) return;
    bodyFetchFailedRef.current.delete(selected.id);
    bodyFetchInFlightRef.current.add(selected.id);
    appFlowLog('manualFetchBody start', {
      messageId: selected.id,
      accountId: selected.account_id,
      mailbox: selected.remote_mailbox,
      uid: selected.remote_uid,
    });
    try {
      const updated = await invoke<Message>('fetch_message_body', { messageId: selected.id });
      const summary = toSummary(updated);
      setMessages((current) => current.map((message) => (message.id === summary.id ? summary : message)));
      if (activeThread) {
        setThreadMessages((current) => current.map((message) => (message.id === summary.id ? summary : message)));
      }
      if (selectedDetail && selectedDetail.id === updated.id) {
        setSelectedDetail(updated);
      }
      onUpdateCache(updated);
      const refreshedAttachments = await invoke<Attachment[]>('list_attachments', { messageId: updated.id });
      setAttachments(refreshedAttachments);
      appFlowLog('manualFetchBody done', {
        messageId: updated.id,
        bodyLength: updated.body.length,
        htmlLength: updated.sanitized_html.length,
        attachments: refreshedAttachments.length,
      });
      if (!isSilent) {
        setStatus('远端正文已拉取并缓存到本地');
      }
    } catch (error) {
      const message = String(error).replace(/^Error:\s*/i, '');
      bodyFetchFailedRef.current.add(selected.id);
      appFlowWarn('manualFetchBody failed', {
        messageId: selected.id,
        accountId: selected.account_id,
        mailbox: selected.remote_mailbox,
        uid: selected.remote_uid,
        error: message,
      });
      if (!isSilent) {
        setStatus(`正文拉取失败：${message}`);
      }
      throw error;
    } finally {
      bodyFetchInFlightRef.current.delete(selected.id);
    }
  }

  async function allowRemoteImagesForSelectedOnce() {
    if (!selected) return;
    const updated = await invoke<Message>('render_message_with_remote_images_once', { messageId: selected.id });
    const summary = toSummary(updated);
    setMessages((current) => current.map((message) => (message.id === summary.id ? summary : message)));
    if (activeThread) {
      setThreadMessages((current) => current.map((message) => (message.id === summary.id ? summary : message)));
    }
    if (selectedDetail && selectedDetail.id === updated.id) {
      setSelectedDetail(updated);
    }
    onUpdateCache(updated);
    setStatus('已允许查看当前邮件的远程图片');
  }

  async function trustRemoteImagesForSelected(scope: 'sender' | 'domain') {
    if (!selected) return;
    const input = remoteImageTrustInput(selected.account_id, selected.sender_email, scope);
    if (!input.value) {
      setStatus('当前发件人地址不完整，无法加入远程图片信任列表');
      return;
    }
    const trust = await invoke<RemoteImageTrust>('trust_remote_images', { input });
    setRemoteImageTrusts((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== trust.id);
      return [...withoutDuplicate, trust].sort((a, b) => `${a.scope}:${a.value}`.localeCompare(`${b.scope}:${b.value}`));
    });
    let updated = await renderSelectedWithRemoteImagePolicy(selected.id);
    if (
      updated?.security_warnings.some((warning) => warning.includes('远程图片')) &&
      selected.remote_uid > 0
    ) {
      bodyFetchFailedRef.current.delete(selected.id);
      await fetchSelectedBody();
      await renderSelectedWithRemoteImagePolicy(selected.id);
    }
    setStatus(scope === 'sender' ? `已信任发件人远程图片：${trust.value}` : `已信任发件人域名远程图片：${trust.value}`);
  }

  async function blockSelectedSender() {
    if (!selected?.sender_email.trim()) {
      setStatus('当前发件人地址不完整，无法阻止');
      return;
    }
    const sender = selected.sender_email.trim().toLowerCase();
    const saved = await invoke<MailRule>('upsert_rule', {
      ruleId: null,
      input: {
        name: `阻止 ${sender}`,
        condition: `from contains ${sender}`,
        action: 'move to spam; stop',
        enabled: true,
      },
    });
    setRules((current) => [...current.filter((rule) => rule.id !== saved.id), saved]);
    await invoke('move_message_to_role', { messageId: selected.id, role: 'spam' });
    const spamFolderId = visibleFolderIdForRole('spam', selected.account_id) ?? folderId;
    await loadMeta(spamFolderId);
    await loadMessages(spamFolderId);
    setSelectedId(selected.id);
    setStatus(`已阻止发件人：${sender}，后续邮件将移入垃圾邮件`);
  }

  async function downloadAttachment(attachment: Attachment) {
    try {
      const result = await invoke<AttachmentDownload>('download_attachment', { attachmentId: attachment.id });
      setAttachments((current) =>
        current.map((item) => (item.id === result.attachment.id ? result.attachment : item)),
      );
      if (!attachment.is_inline) {
        setStatus(result.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!attachment.is_inline) {
        setStatus(`附件下载失败：${message.replace(/^Error:\s*/i, '')}`);
      }
      throw error;
    }
  }

  async function openAttachment(attachment: Attachment) {
    if (!attachment.is_downloaded) {
      setStatus('请先下载附件');
      return;
    }
    const message = await invoke<string>('open_attachment', { attachmentId: attachment.id });
    setStatus(message);
  }

  async function saveAttachmentAs(attachment: Attachment) {
    if (!attachment.is_downloaded) {
      setStatus('请先下载附件');
      return;
    }
    const message = await invoke<string>('save_attachment_as', { attachmentId: attachment.id });
    setStatus(message);
  }

  async function exportSelectedMessage() {
    if (!selected) return;
    const message = await invoke<string>('export_message_as_eml', { messageId: selected.id });
    setStatus(message);
  }

  return {
    fetchSelectedBody,
    renderSelectedWithRemoteImagePolicy,
    allowRemoteImagesForSelectedOnce,
    trustRemoteImagesForSelected,
    blockSelectedSender,
    downloadAttachment,
    openAttachment,
    saveAttachmentAs,
    exportSelectedMessage,
  };
}
