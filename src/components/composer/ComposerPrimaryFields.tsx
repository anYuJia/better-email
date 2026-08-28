import { useCallback, useEffect, useMemo, useRef } from 'react';
import type React from 'react';
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, X } from 'lucide-react';
import type { Contact, DraftInput, OutboundAttachmentInput } from '../../app/types';
import { formatBytes } from '../../mailUtils';
import { AttachmentIcon, attachmentIconAsset } from '../attachmentIcon';
import { buildContactSearchEntries } from './contactSuggestions';
import RecipientField from './RecipientField';
import {
  joinEditableBody,
  parseOriginalQuote,
  plainTextToRichHtml,
  splitEditableBody,
} from './composerBody';
import { normalizeContentId } from '../../app/inlineImages';
import { localFileAssetUrl } from '../../tauriBridge';
import { logError } from '../../app/logger';
import type { ComposerRecipientField } from './ComposerContactsPanel';
import { canonicalRecipientEmails } from './recipientAddresses';
import {
  autoLinkEditorText,
  cleanupEditorTypingFormatMarkers,
  runEditorCommand,
  syncRichTextEmptyState,
} from './richTextCommands';

function insertTabInTextControl(target: HTMLInputElement | HTMLTextAreaElement) {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const nextValue = `${target.value.slice(0, start)}	${target.value.slice(end)}`;
  const nativeSetter = Object.getOwnPropertyDescriptor(
    target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set;
  nativeSetter?.call(target, nextValue);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1));
}

type ComposerPrimaryFieldsProps = {
  draft: DraftInput;
  contacts: Contact[];
  richComposer: boolean;
  dropActive: boolean;
  ccOpen?: boolean;
  bccOpen?: boolean;
  onToggleCc?: () => void;
  onToggleBcc?: () => void;
  onRecipientFieldFocus?: (field: ComposerRecipientField) => void;
  formattingToolbar?: (editorRef: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
  onPickAttachments: () => void;
  onRemoveAttachment: (index: number) => void;
  onAttachmentDrop: React.DragEventHandler<HTMLElement>;
  onAttachmentDragEnter: React.DragEventHandler<HTMLElement>;
  onAttachmentDragLeave: React.DragEventHandler<HTMLElement>;
  onAttachmentDragOver: React.DragEventHandler<HTMLElement>;
  onAttachmentPaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
  buildInlineImageAttachments: (files: File[]) => Promise<OutboundAttachmentInput[]>;
  onInlineImagesAdded: (attachments: OutboundAttachmentInput[]) => void;
};

function ComposerOriginalQuote({ originalQuote }: { originalQuote: string }) {
  const quote = useMemo(() => parseOriginalQuote(originalQuote), [originalQuote]);

  return (
    <section className="composer-original-quote" aria-label="原始邮件，只读">
      <header>
        <span>原始邮件</span>
        <small>只读</small>
      </header>
      {quote.meta.length > 0 && (
        <dl>
          {quote.meta.map((item) => {
            const [label, ...valueParts] = item.split(/[:：]/);
            return (
              <div key={item}>
                <dt>{label.trim()}</dt>
                <dd>{valueParts.join(':').trim()}</dd>
              </div>
            );
          })}
        </dl>
      )}
      {quote.content && <pre>{quote.content}</pre>}
    </section>
  );
}

function attachmentIconMeta(filename: string, mimeType: string) {
  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  const extension = lowerName.split('.').pop()?.replace(/[^a-z0-9]/g, '').slice(0, 4) || 'file';
  if (lowerMime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(lowerName)) {
    return { icon: <FileImage size={25} />, label: extension, tone: 'image' };
  }
  if (/\.(xlsx?|csv|numbers)$/i.test(lowerName)) {
    return { icon: <FileSpreadsheet size={25} />, label: extension, tone: 'sheet' };
  }
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lowerName)) {
    return { icon: <FileArchive size={25} />, label: extension, tone: 'archive' };
  }
  if (lowerMime.startsWith('text/') || /\.(pdf|txt|md|docx?|pages)$/i.test(lowerName)) {
    return { icon: <FileText size={25} />, label: extension, tone: lowerName.endsWith('.pdf') ? 'pdf' : 'text' };
  }
  return { icon: <File size={25} />, label: extension, tone: 'file' };
}

export default function ComposerPrimaryFields({
  draft,
  contacts,
  richComposer,
  dropActive,
  ccOpen = true,
  bccOpen = false,
  onToggleCc,
  onToggleBcc,
  onRecipientFieldFocus,
  formattingToolbar,
  onPatchDraft,
  onPickAttachments,
  onRemoveAttachment,
  onAttachmentDrop,
  onAttachmentDragEnter,
  onAttachmentDragLeave,
  onAttachmentDragOver,
  onAttachmentPaste,
  buildInlineImageAttachments,
  onInlineImagesAdded,
}: ComposerPrimaryFieldsProps) {
  const richBodyRef = useRef<HTMLDivElement>(null);
  const hydratedInlineSrcRef = useRef<Map<string, string>>(new Map());
  const contactSearchEntries = useMemo(
    () => buildContactSearchEntries(contacts),
    [contacts],
  );
  const richBodySyncFrameRef = useRef<number | null>(null);
  const syncedBodyRef = useRef({
    body: '',
    html: '',
  });
  const { editableBody, originalQuote } = useMemo(
    () => splitEditableBody(draft.body),
    [draft.body],
  );
  const regularAttachments = useMemo(
    () => draft.attachments.filter((attachment) => !attachment.is_inline),
    [draft.attachments],
  );
  const blockedRecipientEmails = useMemo(() => ({
    to: [...canonicalRecipientEmails(draft.cc, draft.bcc)],
    cc: [...canonicalRecipientEmails(draft.to, draft.bcc)],
    bcc: [...canonicalRecipientEmails(draft.to, draft.cc)],
  }), [draft.bcc, draft.cc, draft.to]);

  useEffect(() => {
    if (!richComposer) return;
    const editor = richBodyRef.current;
    if (!editor) return;
    if (document.activeElement === editor) return;
    const nextHtml = draft.html_body || plainTextToRichHtml(editableBody);
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
    autoLinkEditorText(editor, { force: true });
    syncRichTextEmptyState(editor);
  }, [draft.html_body, editableBody, richComposer]);

  useEffect(() => {
    if (!richComposer) return;
    const editor = richBodyRef.current;
    if (!editor) return;
    const images = editor.querySelectorAll('img[src^="cid:"]');
    if (images.length === 0) return;
    let cancelled = false;
    images.forEach(async (image) => {
      const cidValue = image.getAttribute('src')?.replace(/^cid:/i, '') ?? '';
      const normalized = normalizeContentId(cidValue);
      const attachment = draft.attachments.find(
        (item) => item.is_inline && normalizeContentId(item.content_id ?? '') === normalized,
      );
      if (!attachment || !attachment.local_path.trim()) return;
      try {
        const assetUrl = await localFileAssetUrl(attachment.local_path);
        if (!cancelled && assetUrl) {
          hydratedInlineSrcRef.current.set(normalized, assetUrl);
          image.setAttribute('src', assetUrl);
        }
      } catch {
        // keep cid: placeholder; the image still ships as an inline attachment
      }
    });
    return () => {
      cancelled = true;
    };
  }, [richComposer, draft.html_body, draft.attachments]);

  const syncRichBodyFromEditor = useCallback((nextTextContent?: string, nextHtml?: string) => {
    const editor = richBodyRef.current;
    if (!editor) return;
    const hydrated = hydratedInlineSrcRef.current;
    const hydratedImages: Array<{ img: HTMLImageElement; cid: string }> = [];
    if (hydrated.size > 0) {
      editor.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
        const src = img.getAttribute('src') ?? '';
        for (const [cid, assetUrl] of hydrated) {
          if (src === assetUrl) {
            hydratedImages.push({ img, cid });
            img.setAttribute('src', `cid:${cid}`);
            break;
          }
        }
      });
    }
    const html = nextHtml ?? editor.innerHTML;
    const empty = syncRichTextEmptyState(editor);
    const persistedHtml = empty ? '' : html;
    const normalizedText = (nextTextContent ?? editor.textContent ?? '').replace(/[\u200b\ufeff]/g, '');
    const nextBody = joinEditableBody(normalizedText, originalQuote);
    if (
      syncedBodyRef.current.body === nextBody &&
      syncedBodyRef.current.html === persistedHtml
    ) {
      return;
    }
    syncedBodyRef.current = {
      body: nextBody,
      html: persistedHtml,
    };
    for (const { img, cid } of hydratedImages) {
      const assetUrl = hydrated.get(cid);
      if (assetUrl) img.setAttribute('src', assetUrl);
    }
    onPatchDraft({
      html_body: persistedHtml,
      body: nextBody,
    });
  }, [onPatchDraft, originalQuote]);

  const scheduleSyncRichBodyFromEditor = useCallback((nextTextContent?: string, nextHtml?: string) => {
    if (richBodySyncFrameRef.current !== null) {
      cancelAnimationFrame(richBodySyncFrameRef.current);
    }
    richBodySyncFrameRef.current = requestAnimationFrame(() => {
      richBodySyncFrameRef.current = null;
      syncRichBodyFromEditor(nextTextContent, nextHtml);
    });
  }, [syncRichBodyFromEditor]);

  function insertHtmlAtCaret(html: string) {
    const editor = richBodyRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const fragment = range.createContextualFragment(html);
      const lastNode = fragment.lastChild;
      range.insertNode(fragment);
      if (lastNode) {
        range.setStartAfter(lastNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else {
      editor.insertAdjacentHTML('beforeend', html);
    }
    scheduleSyncRichBodyFromEditor();
  }

  async function handleRichBodyPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    const otherFiles = Array.from(files).filter((file) => !file.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      try {
        const attachments = await buildInlineImageAttachments(imageFiles);
        insertHtmlAtCaret(
          attachments
            .map((attachment) => (
              `<img src="cid:${attachment.content_id ?? ''}" alt="${(attachment.filename || '图片').replace(/["<>]/g, '')}">`
            ))
            .join(''),
        );
        onInlineImagesAdded(attachments);
      } catch (error) {
        logError(error);
      }
    }
    if (otherFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const syntheticEvent = {
        clipboardData: {
          files: otherFiles as unknown as FileList,
        },
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>;
      onAttachmentPaste(syntheticEvent);
    }
  }

  function handleRichBodyKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const editor = event.currentTarget;
    const nativeEvent = event.nativeEvent;
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;

    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      runEditorCommand(editor, 'insertText', '	');
      return;
    }

    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (['a', 'c', 'x', 'v', 'z', 'y', 'b', 'i', 'u'].includes(key)) {
      // Preserve the WebView/native edit command. We only stop app-level shortcuts.
      event.stopPropagation();
    }
  }

  function handleRichBodyInput(event: React.FormEvent<HTMLDivElement>) {
    const editor = event.currentTarget;
    if (event.nativeEvent.isTrusted) {
      if ((event.nativeEvent as InputEvent).isComposing) return;
      cleanupEditorTypingFormatMarkers(editor);
      if (editor.dataset.skipAutoLink !== 'true') {
        autoLinkEditorText(editor);
      }
    }
    scheduleSyncRichBodyFromEditor(editor.textContent ?? '', editor.innerHTML);
  }

  function handleRichBodyCompositionEnd(event: React.CompositionEvent<HTMLDivElement>) {
    const editor = event.currentTarget;
    cleanupEditorTypingFormatMarkers(editor);
    if (editor.dataset.skipAutoLink !== 'true') {
      autoLinkEditorText(editor);
    }
    scheduleSyncRichBodyFromEditor(editor.textContent ?? '', editor.innerHTML);
  }

  function handleRichBodyBlur(event: React.FocusEvent<HTMLDivElement>) {
    const editor = event.currentTarget;
    cleanupEditorTypingFormatMarkers(editor);
    if (editor.dataset.skipAutoLink !== 'true') {
      autoLinkEditorText(editor, { force: true });
    }
    syncRichBodyFromEditor(editor.textContent ?? '', editor.innerHTML);
  }

  useEffect(() => () => {
    if (richBodySyncFrameRef.current !== null) {
      cancelAnimationFrame(richBodySyncFrameRef.current);
    }
  }, []);

  return (
    <div className="composer-primary-fields">
      <RecipientField
        label="收件人"
        placeholder="输入姓名或邮箱，回车添加"
        value={draft.to}
        contactSearchEntries={contactSearchEntries}
        blockedEmails={blockedRecipientEmails.to}
        onChange={(value) => onPatchDraft({ to: value })}
        onFocus={() => onRecipientFieldFocus?.('to')}
        actions={(
          <>
            <button
              type="button"
              className={ccOpen ? 'is-active' : ''}
              aria-expanded={ccOpen}
              onClick={() => onToggleCc?.()}
            >
              抄送
            </button>
            <button
              type="button"
              className={bccOpen ? 'is-active' : ''}
              aria-expanded={bccOpen}
              onClick={() => onToggleBcc?.()}
            >
              密送
            </button>
          </>
        )}
      />

      {ccOpen && (
        <RecipientField
          label="抄送"
          placeholder="输入姓名或邮箱，回车添加"
          value={draft.cc}
          contactSearchEntries={contactSearchEntries}
          blockedEmails={blockedRecipientEmails.cc}
          onChange={(value) => onPatchDraft({ cc: value })}
          onFocus={() => onRecipientFieldFocus?.('cc')}
        />
      )}

      {bccOpen && (
        <RecipientField
          label="密送"
          placeholder="输入姓名或邮箱，回车添加"
          value={draft.bcc}
          contactSearchEntries={contactSearchEntries}
          blockedEmails={blockedRecipientEmails.bcc}
          onChange={(value) => onPatchDraft({ bcc: value })}
          onFocus={() => onRecipientFieldFocus?.('bcc')}
        />
      )}

      <label className="composer-field-row composer-subject-field">
        <span className="sr-only">主题</span>
        <input
          aria-label="主题"
          value={draft.subject}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-gramm="false"
          onChange={(event) => onPatchDraft({ subject: event.target.value })}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'Tab') {
              event.preventDefault();
              event.stopPropagation();
              insertTabInTextControl(event.currentTarget);
              return;
            }
            if ((event.metaKey || event.ctrlKey) && !event.altKey) event.stopPropagation();
          }}
          placeholder="添加主题"
        />
      </label>

      {formattingToolbar?.(richBodyRef)}

      <section
        className={`composer-body-field${originalQuote ? ' has-original-quote' : ''}${dropActive ? ' drop-active' : ''}`}
        aria-label="邮件正文"
        onDrop={onAttachmentDrop}
        onDragEnter={onAttachmentDragEnter}
        onDragLeave={onAttachmentDragLeave}
        onDragOver={onAttachmentDragOver}
      >
        {richComposer ? (
          <div
            ref={richBodyRef}
            className="composer-richtext-body"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="开始写邮件…"
            role="textbox"
            aria-multiline="true"
            aria-label="邮件正文（富文本）"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-gramm="false"
            onKeyDownCapture={handleRichBodyKeyDown}
            onInput={handleRichBodyInput}
            onCompositionEnd={handleRichBodyCompositionEnd}
            onBlur={handleRichBodyBlur}
            onPaste={handleRichBodyPaste}
            onDrop={onAttachmentDrop}
            onDragEnter={onAttachmentDragEnter}
            onDragLeave={onAttachmentDragLeave}
            onDragOver={onAttachmentDragOver}
          />
        ) : (
          <textarea
            aria-label="邮件正文"
            value={editableBody}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-gramm="false"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                insertTabInTextControl(event.currentTarget);
                return;
              }
              if ((event.metaKey || event.ctrlKey) && !event.altKey) event.stopPropagation();
            }}
            onDrop={onAttachmentDrop}
            onDragEnter={onAttachmentDragEnter}
            onDragLeave={onAttachmentDragLeave}
            onDragOver={onAttachmentDragOver}
            onPaste={onAttachmentPaste}
            onChange={(event) => {
              const nextBody = joinEditableBody(event.target.value, originalQuote);
              onPatchDraft({
                body: nextBody,
                html_body: richComposer
                  ? `<p>${nextBody.replace(/\n/g, '<br>')}</p>`
                  : draft.html_body,
              });
            }}
            placeholder="开始写邮件…"
          />
        )}
        {regularAttachments.length > 0 && (
          <section className="composer-body-attachments composer-attachment-list" aria-label="附件">
            {regularAttachments.map((attachment) => {
              const iconMeta = attachmentIconMeta(attachment.filename, attachment.mime_type);
              const customIcon = attachmentIconAsset(attachment.filename, attachment.mime_type);
              const attachmentIndex = draft.attachments.indexOf(attachment);
              return (
                <article className={`composer-attachment-tile attachment-${iconMeta.tone}`} key={`${attachment.filename}-${attachmentIndex}`}>
                  <span className={`composer-attachment-filemark${customIcon ? ' composer-attachment-filemark-has-asset' : ''}`} aria-hidden="true">
                    {customIcon ? (
                      <AttachmentIcon filename={attachment.filename} mimeType={attachment.mime_type} />
                    ) : (
                      <>
                        <span className="composer-attachment-filemark-fold" />
                        <span className="composer-attachment-filemark-icon">
                          {iconMeta.icon}
                        </span>
                        <span className="composer-attachment-filemark-label">{iconMeta.label}</span>
                      </>
                    )}
                  </span>
                  <span className="composer-attachment-tile-copy">
                    <strong title={attachment.filename}>{attachment.filename}</strong>
                    <small>{formatBytes(attachment.size_bytes)}</small>
                  </span>
                  <button type="button" aria-label={`移除 ${attachment.filename}`} onClick={() => onRemoveAttachment(attachmentIndex)}>
                    <X size={14} />
                  </button>
                </article>
              );
            })}
          </section>
        )}
        {draft.attachments.length === 0 && dropActive && (
          <button type="button" className="composer-body-attachment-empty" onClick={onPickAttachments}>
            松开添加附件
          </button>
        )}
        {originalQuote && <ComposerOriginalQuote originalQuote={originalQuote} />}
      </section>
    </div>
  );
}
