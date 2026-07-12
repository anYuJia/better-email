import React, { useEffect, useState } from 'react';
import {
  Archive,
  Clock,
  Download,
  Forward,
  Image as ImageIcon,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Reply,
  ReplyAll,
  RotateCcw,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { movableFoldersForBulk, movableFoldersForMessage } from '../app/appConfig';
import { resolveCidInlineImages } from '../app/inlineImages';
import { canSnoozeRole } from '../app/snooze';
import type {
  AccountScope,
  Attachment,
  Folder,
  Label,
  Message,
  ThreadSummary,
} from '../app/types';
import { formatBytes, formatDate } from '../mailUtils';
import { localFileAssetUrl } from '../tauriBridge';
import type { BulkMessageAction } from './messageContextMenu';

type ComposeMode = 'reply' | 'replyAll' | 'forward';
type TrustScope = 'sender' | 'domain';
type PlainBodyBlock =
  | { type: 'text'; content: string }
  | { type: 'original'; index: number; meta: string[]; content: string };

export type ReaderPaneProps = {
  activeThread: ThreadSummary | null;
  threadMessages: Message[];
  activeThreadSelected: Message | null;
  selected: Message | null;
  selectedId: number | null;
  accountScope: AccountScope;
  folders: Folder[];
  labels: Label[];
  attachments: Attachment[];
  selectedSenderTrusted: boolean;
  selectedSenderDomain: string;
  selectedHasRemoteImageWarning: boolean;
  quickReplyBody: string;
  onSelectMessage: (messageId: number) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode) => void;
  onRunThreadAction: (action: BulkMessageAction) => void;
  onMoveThreadToFolder: (folder: Folder) => void;
  onToggleThreadLabel: (label: Label) => void;
  onToggleThreadMute: () => void;
  onToggleStar: (message: Message) => void;
  onEditDraft: (message: Message) => void;
  onRestoreFromTrash: () => void;
  onMoveArchive: () => void;
  onMoveTrash: () => void;
  onToggleRead: (message: Message) => void;
  onUnsnooze: () => void;
  onSnooze: () => void;
  onExportMessage: () => void;
  onFetchBody: () => void;
  onMarkNotSpam: () => void;
  onMarkAsSpam: () => void;
  onTrustRemoteImages: (scope: TrustScope) => void;
  onBlockSender: () => void;
  onPermanentlyDelete: () => void;
  onEmptyTrash: () => void;
  onMoveToFolder: (folder: Folder) => void;
  onToggleLabel: (label: Label) => void;
  onOpenAttachment: (attachment: Attachment) => void;
  onDownloadAttachment: (attachment: Attachment) => void | Promise<void>;
  onSaveAttachmentAs: (attachment: Attachment) => void;
  onQuickReplyChange: (value: string) => void;
  onSendQuickReply: (message: Message) => void;
};

function senderInitial(message: Message) {
  return (message.sender_name || message.sender_email || '?').trim().slice(0, 1).toUpperCase();
}

function attachmentErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, '').trim() || '附件下载失败，请重试。';
}

function SenderIdentity({ message }: { message: Message }) {
  return (
    <div className="reader-sender">
      <span className={`reader-avatar avatar-tone-${Math.abs(message.id) % 6}`} aria-hidden="true">
        {senderInitial(message)}
      </span>
      <span className="reader-sender-copy">
        <strong>{message.sender_name || message.sender_email}</strong>
        <span>
          {message.sender_email}
          {message.recipients ? ` 发给 ${message.recipients}` : ''}
        </span>
      </span>
    </div>
  );
}

const originalMessageMarkerPattern = /^\s*-{2,}\s*(?:原始邮件|original message|forwarded message)\s*-{2,}\s*$/i;
const originalMessageMetaPattern = /^\s*(?:发件人|收件人|抄送|时间|日期|主题|from|to|cc|date|subject)\s*[:：]/i;

function stripQuotePrefix(line: string) {
  return line.replace(/^\s*(?:>\s*)+/, '').trimEnd();
}

function formatPlainTextContent(lines: string[]) {
  return lines
    .map((line) => stripQuotePrefix(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parsePlainBody(body: string): PlainBodyBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: PlainBodyBlock[] = [];
  let textBuffer: string[] = [];
  let originalIndex = 0;

  const flushText = () => {
    const content = textBuffer.join('\n').trim();
    if (content) blocks.push({ type: 'text', content });
    textBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!originalMessageMarkerPattern.test(line)) {
      textBuffer.push(line);
      continue;
    }

    flushText();
    originalIndex += 1;

    const meta: string[] = [];
    const content: string[] = [];
    let sawContent = false;

    index += 1;
    for (; index < lines.length; index += 1) {
      const nextLine = lines[index];
      if (originalMessageMarkerPattern.test(nextLine)) {
        index -= 1;
        break;
      }
      if (!sawContent && originalMessageMetaPattern.test(nextLine)) {
        meta.push(nextLine.trim());
        continue;
      }
      if (!sawContent && !nextLine.trim()) {
        continue;
      }
      sawContent = true;
      content.push(nextLine);
    }

    blocks.push({
      type: 'original',
      index: originalIndex,
      meta,
      content: formatPlainTextContent(content),
    });
  }

  flushText();

  if (blocks.length === 0 && body.trim()) {
    return [{ type: 'text', content: body.trim() }];
  }
  return blocks;
}

function PlainMessageBody({ body }: { body: string }) {
  const blocks = parsePlainBody(body);

  return (
    <div className="body-text">
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          return (
            <div className="plain-body-copy" key={`text-${index}`}>
              {block.content}
            </div>
          );
        }

        return (
          <section className="original-message-block" key={`original-${block.index}-${index}`}>
            <header>
              <span>原始邮件</span>
              {blocks.filter((item) => item.type === 'original').length > 1 && (
                <small>{block.index}</small>
              )}
            </header>
            {block.meta.length > 0 && (
              <dl>
                {block.meta.map((item) => {
                  const [label, ...valueParts] = item.split(/[:：]/);
                  return (
                    <React.Fragment key={item}>
                      <dt>{label.trim()}</dt>
                      <dd>{valueParts.join(':').trim()}</dd>
                    </React.Fragment>
                  );
                })}
              </dl>
            )}
            {block.content && <pre>{block.content}</pre>}
          </section>
        );
      })}
    </div>
  );
}

export default function ReaderPane({
  activeThread,
  threadMessages,
  activeThreadSelected,
  selected,
  selectedId,
  accountScope,
  folders,
  labels,
  attachments,
  selectedSenderTrusted,
  selectedSenderDomain,
  selectedHasRemoteImageWarning,
  quickReplyBody,
  onSelectMessage,
  onComposeFromMessage,
  onRunThreadAction,
  onMoveThreadToFolder,
  onToggleThreadLabel,
  onToggleThreadMute,
  onToggleStar,
  onEditDraft,
  onRestoreFromTrash,
  onMoveArchive,
  onMoveTrash,
  onToggleRead,
  onUnsnooze,
  onSnooze,
  onExportMessage,
  onFetchBody,
  onMarkNotSpam,
  onMarkAsSpam,
  onTrustRemoteImages,
  onBlockSender,
  onPermanentlyDelete,
  onEmptyTrash,
  onMoveToFolder,
  onToggleLabel,
  onOpenAttachment,
  onDownloadAttachment,
  onSaveAttachmentAs,
  onQuickReplyChange,
  onSendQuickReply,
}: ReaderPaneProps) {
  const [downloadingAttachmentIds, setDownloadingAttachmentIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
  const [isDownloadingAllAttachments, setIsDownloadingAllAttachments] = useState(false);
  const [isDownloadingInlineImages, setIsDownloadingInlineImages] = useState(false);
  const regularAttachments = attachments.filter((attachment) => !attachment.is_inline);
  const pendingAttachmentCount = regularAttachments.filter(
    (attachment) => !attachment.is_downloaded,
  ).length;
  const inlineImageResolution = resolveCidInlineImages(
    selected?.sanitized_html ?? '',
    attachments,
    localFileAssetUrl,
  );
  const inlineImageError = inlineImageResolution.pendingAttachments
    .map((attachment) => attachmentErrors[attachment.id])
    .find(Boolean) ?? '';
  const visibleSecurityWarnings = selected?.security_warnings.filter(
    (warning) => warning !== '正文包含外部链接，请核对域名后再访问。',
  ) ?? [];

  useEffect(() => {
    setDownloadingAttachmentIds(new Set());
    setAttachmentErrors({});
    setIsDownloadingAllAttachments(false);
    setIsDownloadingInlineImages(false);
  }, [selectedId]);

  async function handleAttachmentDownload(attachment: Attachment): Promise<boolean> {
    if (downloadingAttachmentIds.has(attachment.id)) return false;
    setAttachmentErrors((current) => {
      const next = { ...current };
      delete next[attachment.id];
      return next;
    });
    setDownloadingAttachmentIds((current) => {
      const next = new Set(current);
      next.add(attachment.id);
      return next;
    });
    try {
      await onDownloadAttachment(attachment);
      return true;
    } catch (error) {
      setAttachmentErrors((current) => ({
        ...current,
        [attachment.id]: attachmentErrorMessage(error),
      }));
      return false;
    } finally {
      setDownloadingAttachmentIds((current) => {
        const next = new Set(current);
        next.delete(attachment.id);
        return next;
      });
    }
  }

  async function handleDownloadAllAttachments() {
    if (isDownloadingAllAttachments) return;
    const pending = regularAttachments.filter((attachment) => !attachment.is_downloaded);
    if (pending.length === 0) return;
    setIsDownloadingAllAttachments(true);
    try {
      for (const attachment of pending) {
        await handleAttachmentDownload(attachment);
      }
    } finally {
      setIsDownloadingAllAttachments(false);
    }
  }

  async function handleLoadInlineImages() {
    if (isDownloadingInlineImages || inlineImageResolution.pendingAttachments.length === 0) {
      return;
    }
    setIsDownloadingInlineImages(true);
    try {
      for (const attachment of inlineImageResolution.pendingAttachments) {
        await handleAttachmentDownload(attachment);
      }
    } finally {
      setIsDownloadingInlineImages(false);
    }
  }

  if (activeThread && threadMessages.length > 0) {
    const allThreadRead = threadMessages.every((message) => message.is_read);
    const allThreadStarred = threadMessages.every((message) => message.is_starred);
    const threadMovableMessages = threadMessages.filter(
      (message) => message.folder_role !== 'drafts' && message.folder_role !== 'sent',
    );
    const threadArchiveCount = threadMessages.filter(
      (message) => !['archive', 'drafts', 'sent', 'trash'].includes(message.folder_role),
    ).length;
    const threadTrashCount = threadMessages.filter(
      (message) => message.folder_role !== 'drafts' && message.folder_role !== 'trash',
    ).length;
    const threadMoveFolders = movableFoldersForBulk(folders, threadMovableMessages);

    return (
      <section className="reader-panel">
        <article className="reader thread-reader">
          <header className="reader-header">
            <div className="reader-title-block">
              <h1>{activeThread.subject || '(无主题)'}</h1>
              <p>{activeThread.participants} · {threadMessages.length} 封邮件 · 未读 {activeThread.unread_count}</p>
            </div>
            <div className="reader-actions">
              <button
                className="icon-only-action"
                title={allThreadStarred ? '取消整个会话星标' : '添加整个会话星标'}
                aria-label={allThreadStarred ? '取消整个会话星标' : '添加整个会话星标'}
                onClick={() => onRunThreadAction(allThreadStarred ? 'unstar' : 'star')}
              >
                <Star size={17} fill={allThreadStarred ? 'currentColor' : 'none'} />
              </button>
              <button
                className="primary-action"
                title="回复最新邮件"
                onClick={() => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'reply')}
              >
                <Reply size={16} />
                <span>回复</span>
              </button>
              <button
                className="icon-only-action"
                title="回复全部"
                aria-label="回复全部"
                onClick={() => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'replyAll')}
              >
                <ReplyAll size={17} />
              </button>
              <button
                className="icon-only-action"
                title="转发最新邮件"
                aria-label="转发最新邮件"
                onClick={() => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'forward')}
              >
                <Forward size={17} />
              </button>
              <button
                className="icon-only-action"
                title="归档会话中的收件邮件"
                aria-label="归档会话中的收件邮件"
                disabled={threadArchiveCount === 0}
                onClick={() => onRunThreadAction('archive')}
              >
                <Archive size={16} />
              </button>
              <button
                className="icon-only-action"
                title={allThreadRead ? '整个会话标为未读' : '整个会话标为已读'}
                aria-label={allThreadRead ? '整个会话标为未读' : '整个会话标为已读'}
                onClick={() => onRunThreadAction(allThreadRead ? 'unread' : 'read')}
              >
                {allThreadRead ? <Mail size={16} /> : <MailOpen size={16} />}
              </button>
              <button
                className="icon-only-action danger-action"
                title="将会话移到废纸篓"
                aria-label="将会话移到废纸篓"
                disabled={threadTrashCount === 0}
                onClick={() => onRunThreadAction('trash')}
              >
                <Trash2 size={16} />
              </button>
              <details className="reader-more-menu compact-menu">
                <summary className="icon-only-summary" title="更多会话操作" aria-label="更多会话操作">
                  <MoreHorizontal size={17} />
                </summary>
                <div>
                  <span className="menu-section-title">会话</span>
                  <button type="button" onClick={onToggleThreadMute}>
                    {activeThread.is_muted ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    {activeThread.is_muted ? '取消静音会话' : '静音会话'}
                  </button>
                  <span className="menu-section-title">标签</span>
                  {labels.map((label) => (
                    <button
                      type="button"
                      key={label.id}
                      className={threadMessages.every((message) => message.labels.includes(label.name)) ? 'active' : ''}
                      onClick={() => onToggleThreadLabel(label)}
                    >
                      <span className="label-dot" style={{ background: label.color }} />
                      {label.name}
                    </button>
                  ))}
                  <span className="menu-section-title">移动到</span>
                  {threadMoveFolders.map((folder) => (
                    <button type="button" key={folder.id} onClick={() => onMoveThreadToFolder(folder)}>
                      {folder.name}
                    </button>
                  ))}
                  {threadMoveFolders.length === 0 && (
                    <span className="menu-empty-note">多账号会话或当前邮件不可移动</span>
                  )}
                </div>
              </details>
            </div>
          </header>
          <div className="thread-stack">
            {threadMessages.map((message) => (
              <section
                className={message.id === selectedId ? 'thread-message active' : 'thread-message'}
                key={message.id}
                onClick={() => onSelectMessage(message.id)}
              >
                <header>
                  <SenderIdentity message={message} />
                  <time>{formatDate(message.received_at)}</time>
                </header>
                <p>{message.snippet || message.body}</p>
                <div className="message-chips">
                  <span>{message.folder_role}</span>
                  {message.labels.map((label) => <span key={label}>{label}</span>)}
                  {message.attachment_count > 0 && <span><Paperclip size={12} /> {message.attachment_count}</span>}
                </div>
              </section>
            ))}
          </div>
        </article>
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="reader-panel">
        <div className="empty-reader">
          <div className="empty-reader-card">
            <div className="empty-state-mark">
              <Mail size={24} />
            </div>
            <strong>选择一封邮件开始阅读</strong>
            <span>常用动作会保持可见，整理与安全选项按需展开。</span>
          </div>
        </div>
      </section>
    );
  }

  const isDraft = selected.folder_role === 'drafts';
  const isTrash = selected.folder_role === 'trash';

  return (
    <section className="reader-panel">
      <article className="reader">
        <header className="reader-header">
          <div className="reader-title-block">
            <h1>{selected.subject || '(无主题)'}</h1>
            <SenderIdentity message={selected} />
          </div>
          <div className="reader-actions" aria-label="邮件操作">
            <button
              className="icon-only-action"
              title={selected.is_starred ? '取消星标' : '添加星标'}
              aria-label={selected.is_starred ? '取消星标' : '添加星标'}
              onClick={() => onToggleStar(selected)}
            >
              <Star size={17} fill={selected.is_starred ? 'currentColor' : 'none'} />
            </button>
            {isDraft ? (
              <button className="primary-action" title="继续编辑草稿" onClick={() => onEditDraft(selected)}>
                <MailOpen size={16} />
                <span>继续编辑</span>
              </button>
            ) : (
              <>
                <button className="primary-action" title="回复" onClick={() => onComposeFromMessage(selected, 'reply')}>
                  <Reply size={16} />
                  <span>回复</span>
                </button>
                <button
                  className="icon-only-action"
                  title="回复全部"
                  aria-label="回复全部"
                  onClick={() => onComposeFromMessage(selected, 'replyAll')}
                >
                  <ReplyAll size={17} />
                </button>
                <button
                  className="icon-only-action"
                  title="转发"
                  aria-label="转发"
                  onClick={() => onComposeFromMessage(selected, 'forward')}
                >
                  <Forward size={17} />
                </button>
              </>
            )}
            {isTrash ? (
              <button title="恢复邮件" onClick={onRestoreFromTrash}>
                <RotateCcw size={16} />
                <span>恢复</span>
              </button>
            ) : !isDraft && (
              <button className="icon-only-action" aria-label="归档" title="归档" onClick={onMoveArchive}>
                <Archive size={16} />
              </button>
            )}
            {!isDraft && (
              <button
                className="icon-only-action"
                aria-label={selected.is_read ? '标为未读' : '标为已读'}
                title={selected.is_read ? '标为未读' : '标为已读'}
                onClick={() => onToggleRead(selected)}
              >
                <Mail size={16} />
              </button>
            )}
            {!isTrash && (
              <button className="icon-only-action danger-action" aria-label="删除" title="删除" onClick={onMoveTrash}>
                <Trash2 size={16} />
              </button>
            )}
            <details className="reader-more-menu compact-menu">
              <summary className="icon-only-summary" title="更多操作" aria-label="更多操作">
                <MoreHorizontal size={17} />
              </summary>
              <div>
                <span className="menu-section-title">整理</span>
                {selected.folder_role === 'snoozed' ? (
                  <button onClick={onUnsnooze}><Clock size={16} /> 取消稍后</button>
                ) : canSnoozeRole(selected.folder_role) && (
                  <button onClick={onSnooze}><Clock size={16} /> 稍后处理</button>
                )}
                <button onClick={onExportMessage}>导出 EML</button>
                {selected.remote_uid > 0 && !selected.body.trim() && (
                  <button onClick={onFetchBody}>拉取正文</button>
                )}
                {selected.folder_role === 'spam' ? (
                  <button onClick={onMarkNotSpam}>不是垃圾邮件</button>
                ) : (
                  <button onClick={onMarkAsSpam}>标为垃圾邮件</button>
                )}
                {!isDraft && selected.sender_email.trim() && (
                  <>
                    <span className="menu-section-title">安全</span>
                    {!selectedSenderTrusted && (
                      <button onClick={() => onTrustRemoteImages('sender')}>信任该发件人</button>
                    )}
                    {selectedSenderDomain && !selectedSenderTrusted && (
                      <button onClick={() => onTrustRemoteImages('domain')}>信任 {selectedSenderDomain}</button>
                    )}
                    <button onClick={onBlockSender}>阻止该发件人</button>
                  </>
                )}
                {isTrash && (
                  <>
                    <span className="menu-section-title">删除</span>
                    <button className="danger-menu-item" onClick={onPermanentlyDelete}>
                      <Trash2 size={16} /> 永久删除
                    </button>
                    <button className="danger-menu-item" onClick={onEmptyTrash}>清空废纸篓</button>
                  </>
                )}
                <span className="menu-section-title">移动到</span>
                {movableFoldersForMessage(folders, selected).map((folder) => (
                  <button type="button" key={folder.id} onClick={() => onMoveToFolder(folder)}>
                    {folder.name}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </header>

        <div className="reader-meta">
          <span>{formatDate(selected.received_at)}</span>
          {accountScope === 'all' && <span>{selected.account_email}</span>}
          {selected.snoozed_until && <span>稍后到 {formatDate(selected.snoozed_until)}</span>}
          {selected.has_attachments && <span>含附件</span>}
        </div>

        <div className="label-tools">
          {selected.labels.length === 0 && <span className="label-empty">无标签</span>}
          {selected.labels.map((labelName) => {
            const label = labels.find((item) => item.name === labelName);
            return (
              <span className="active-label-chip" key={labelName}>
                <span className="label-dot" style={{ background: label?.color ?? '#8b95a1' }} />
                {labelName}
              </span>
            );
          })}
          <details className="compact-menu label-menu">
            <summary><Tag size={15} /> 标签</summary>
            <div>
              {labels.map((label) => (
                <button
                  type="button"
                  key={label.id}
                  className={selected.labels.includes(label.name) ? 'active' : ''}
                  onClick={() => onToggleLabel(label)}
                >
                  <span className="label-dot" style={{ background: label.color }} />
                  {label.name}
                </button>
              ))}
            </div>
          </details>
        </div>

        {regularAttachments.length > 0 && (
          <div className="attachment-section">
            <header className="attachment-section-header">
              <span>
                <strong>附件</strong>
                <small>{regularAttachments.length} 个 · {formatBytes(regularAttachments.reduce((sum, item) => sum + item.size_bytes, 0))}</small>
              </span>
              {pendingAttachmentCount > 0 && (
                <button
                  type="button"
                  disabled={isDownloadingAllAttachments}
                  aria-busy={isDownloadingAllAttachments}
                  onClick={handleDownloadAllAttachments}
                >
                  <Download size={14} />
                  {isDownloadingAllAttachments
                    ? '顺序下载中…'
                    : `下载全部 ${pendingAttachmentCount} 个`}
                </button>
              )}
            </header>
            <div className="attachments">
              {regularAttachments.map((attachment) => {
                const downloading = downloadingAttachmentIds.has(attachment.id);
                const transferError = attachmentErrors[attachment.id] ?? '';
                return (
                <div className={transferError ? 'attachment-download-failed' : ''} key={attachment.id}>
                  <span className="attachment-icon"><Paperclip size={15} /></span>
                  <strong>{attachment.filename}</strong>
                  <span>{attachment.mime_type}</span>
                  <em>{formatBytes(attachment.size_bytes)}</em>
                  <button
                    type="button"
                    title={attachment.local_path || attachment.filename}
                    disabled={downloading}
                    aria-busy={downloading}
                    onClick={() => attachment.is_downloaded
                      ? onOpenAttachment(attachment)
                      : handleAttachmentDownload(attachment)}
                  >
                    {attachment.is_downloaded
                      ? '打开'
                      : downloading ? '下载中…' : transferError ? '重试' : '下载'}
                  </button>
                  {attachment.is_downloaded && (
                    <button type="button" title={`另存为 ${attachment.filename}`} onClick={() => onSaveAttachmentAs(attachment)}>
                      另存为
                    </button>
                  )}
                  {transferError && (
                    <small className="attachment-transfer-status" role="status">
                      {transferError}
                    </small>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}

        {(inlineImageResolution.pendingAttachments.length > 0
          || inlineImageResolution.missingContentIds.length > 0) && (
          <div className="inline-image-notice" role="status">
            <span className="inline-image-notice-icon" aria-hidden="true">
              <ImageIcon size={16} />
            </span>
            <span className="inline-image-notice-copy">
              <strong>
                {inlineImageResolution.pendingAttachments.length > 0
                  ? `正文包含 ${inlineImageResolution.pendingAttachments.length} 张内嵌图片`
                  : '部分内嵌图片不可用'}
              </strong>
              <small>
                {inlineImageError
                  || (inlineImageResolution.missingContentIds.length > 0
                    ? `${inlineImageResolution.missingContentIds.length} 张图片未包含在邮件中`
                    : '按需加载，减少内存和网络占用')}
              </small>
            </span>
            {inlineImageResolution.pendingAttachments.length > 0 && (
              <button
                type="button"
                disabled={isDownloadingInlineImages}
                aria-busy={isDownloadingInlineImages}
                onClick={handleLoadInlineImages}
              >
                {isDownloadingInlineImages ? '加载中…' : inlineImageError ? '重试' : '显示图片'}
              </button>
            )}
          </div>
        )}

        {visibleSecurityWarnings.length > 0 && (
          <div className="reader-warning-panel">
            <div className="reader-warning-heading">
              <strong>安全提示</strong>
              {selectedHasRemoteImageWarning && (
                <span>{selectedSenderTrusted ? '当前发件人已信任' : '远程图片默认阻止'}</span>
              )}
            </div>
            {visibleSecurityWarnings.map((warning) => <p key={warning}>{warning}</p>)}
            {selectedHasRemoteImageWarning && (
              <details className="compact-menu reader-warning-actions">
                <summary><SlidersHorizontal size={15} /> 处理</summary>
                <div>
                  <button type="button" onClick={() => onTrustRemoteImages('sender')}>信任该发件人</button>
                  {selectedSenderDomain && (
                    <button type="button" onClick={() => onTrustRemoteImages('domain')}>
                      信任 {selectedSenderDomain}
                    </button>
                  )}
                  <button type="button" onClick={onBlockSender}>阻止该发件人</button>
                </div>
              </details>
            )}
          </div>
        )}

        {selected.sanitized_html ? (
          <div className="reader-html" dangerouslySetInnerHTML={{ __html: inlineImageResolution.html }} />
        ) : (
          <PlainMessageBody body={selected.body} />
        )}

        {!isDraft && !isTrash && (
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
        )}
      </article>
    </section>
  );
}
