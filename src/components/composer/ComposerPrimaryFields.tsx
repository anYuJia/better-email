import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type React from 'react';
import { ChevronDown, ChevronUp, File, FileArchive, FileImage, FileSpreadsheet, FileText, X } from 'lucide-react';
import type { Contact, DraftInput, OutboundAttachmentInput } from '../../app/types';
import { formatBytes } from '../../mailUtils';
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

function indentPlainText(target: HTMLTextAreaElement, outdent: boolean) {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const lineStart = start === 0 ? 0 : target.value.lastIndexOf('\n', start - 1) + 1;
  // A selection ending at the next line's beginning does not include that line.
  const selectedEnd = end > start && target.value[end - 1] === '\n' ? end - 1 : end;
  const nextBreak = target.value.indexOf('\n', selectedEnd);
  const lineEnd = nextBreak === -1 ? target.value.length : nextBreak;
  const lines = target.value.slice(lineStart, lineEnd).split('\n');
  const changes = lines.map((line) => outdent ? -(line.match(/^(?:\t| {1,4})/)?.[0].length ?? 0) : 1);
  const replacement = lines.map((line, index) => outdent ? line.slice(-changes[index]) : `\t${line}`).join('\n');
  const nextValue = target.value.slice(0, lineStart) + replacement + target.value.slice(lineEnd);
  const nextStart = Math.max(lineStart, start + changes[0]);
  const nextEnd = Math.max(nextStart, end + changes.reduce((total, change) => total + change, 0));
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  nativeSetter?.call(target, nextValue);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => {
    if (target.isConnected && document.activeElement === target && target.value === nextValue) {
      target.setSelectionRange(nextStart, nextEnd);
    }
  });
}

type ComposerPrimaryFieldsProps = {
  mobile?: boolean;
  active?: boolean;
  flushPendingRef?: React.MutableRefObject<(() => void) | null>;
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
    return { icon: <FileImage size={20} />, label: extension, tone: 'image' };
  }
  if (/\.(xlsx?|csv|numbers)$/i.test(lowerName)) {
    return { icon: <FileSpreadsheet size={20} />, label: extension, tone: 'sheet' };
  }
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lowerName)) {
    return { icon: <FileArchive size={20} />, label: extension, tone: 'archive' };
  }
  if (lowerMime.startsWith('text/') || /\.(pdf|txt|md|docx?|pages)$/i.test(lowerName)) {
    return { icon: <FileText size={20} />, label: extension, tone: lowerName.endsWith('.pdf') ? 'pdf' : 'text' };
  }
  return { icon: <File size={20} />, label: extension, tone: 'file' };
}

export default function ComposerPrimaryFields({
  mobile = false,
  active = true,
  flushPendingRef,
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
  const attachmentsRef = useRef<HTMLElement>(null);
  const removalFocusRef = useRef<{ index: number; composer: Element | null; trigger: HTMLElement } | null>(null);
  const renderedHtmlRef = useRef<string | null>(null);
  const hydratedInlineSrcRef = useRef<Map<string, string>>(new Map());
  const contactSearchEntries = useMemo(
    () => buildContactSearchEntries(contacts),
    [contacts],
  );
  const richBodySyncFrameRef = useRef<number | null>(null);
  const richBodySyncGenerationRef = useRef(0);
  const cancelPendingRichBodySync = useCallback(() => {
    richBodySyncGenerationRef.current += 1;
    if (richBodySyncFrameRef.current !== null) cancelAnimationFrame(richBodySyncFrameRef.current);
    richBodySyncFrameRef.current = null;
  }, []);
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
  useLayoutEffect(() => {
    const pending = removalFocusRef.current;
    if (!pending) return;
    removalFocusRef.current = null;
    if (pending.trigger.isConnected || (document.activeElement !== document.body && document.activeElement !== pending.trigger)) return;
    const actions = attachmentsRef.current?.querySelectorAll<HTMLButtonElement>('button');
    const target = actions?.[Math.min(pending.index, actions.length - 1)]
      ?? pending.composer?.querySelector<HTMLButtonElement>('[aria-label="添加附件"]');
    target?.focus({ preventScroll: true });
  }, [regularAttachments]);
  const blockedRecipientEmails = useMemo(() => ({
    to: [...canonicalRecipientEmails(draft.cc, draft.bcc)],
    cc: [...canonicalRecipientEmails(draft.to, draft.bcc)],
    bcc: [...canonicalRecipientEmails(draft.to, draft.cc)],
  }), [draft.bcc, draft.cc, draft.to]);

  useEffect(() => {
    if (!richComposer) {
      renderedHtmlRef.current = null;
      return;
    }
    if (!active) return;
    const editor = richBodyRef.current;
    if (!editor) return;
    if (document.activeElement === editor) return;
    const nextHtml = draft.html_body || plainTextToRichHtml(editableBody);
    // A hidden/restored editor already owns this source, including hydrated CID
    // images. Rewriting it would reset selection and the native undo history.
    if (renderedHtmlRef.current === nextHtml) return;
    if (editor.innerHTML !== nextHtml) {
      editor.innerHTML = nextHtml;
    }
    autoLinkEditorText(editor, { force: true });
    syncRichTextEmptyState(editor);
    renderedHtmlRef.current = nextHtml;
  }, [active, draft.html_body, editableBody, richComposer]);

  useEffect(() => {
    if (!richComposer || !active) return;
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
  }, [active, richComposer, draft.html_body, draft.attachments]);

  const syncRichBodyFromEditor = useCallback((nextTextContent?: string, nextHtml?: string) => {
    const editor = richBodyRef.current;
    if (!editor) return;
    const hydrated = hydratedInlineSrcRef.current;
    let html = nextHtml ?? editor.innerHTML;
    if (hydrated.size > 0) {
      const sourceToCid = new Map(Array.from(hydrated, ([cid, source]) => [source, cid]));
      if (Array.from(editor.querySelectorAll('img[src]')).some((image) => sourceToCid.has(image.getAttribute('src') ?? ''))) {
        // Persist CID references without touching live images. Even a temporary
        // src rewrite can reload previews and disturb the browser's undo stack.
        const copy = editor.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('img[src]').forEach((image) => {
          const cid = sourceToCid.get(image.getAttribute('src') ?? '');
          if (cid) image.setAttribute('src', `cid:${cid}`);
        });
        html = copy.innerHTML;
      }
    }
    const empty = syncRichTextEmptyState(editor);
    const persistedHtml = empty ? '' : html;
    renderedHtmlRef.current = persistedHtml;
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
    onPatchDraft({
      html_body: persistedHtml,
      body: nextBody,
    });
  }, [onPatchDraft, originalQuote]);

  const scheduleSyncRichBodyFromEditor = useCallback((nextTextContent?: string, nextHtml?: string) => {
    if (!active) return;
    cancelPendingRichBodySync();
    const generation = richBodySyncGenerationRef.current;
    richBodySyncFrameRef.current = requestAnimationFrame(() => {
      if (generation !== richBodySyncGenerationRef.current) return;
      richBodySyncFrameRef.current = null;
      syncRichBodyFromEditor(nextTextContent, nextHtml);
    });
  }, [active, cancelPendingRichBodySync, syncRichBodyFromEditor]);

  const flushRichBody = useCallback(() => {
    cancelPendingRichBodySync();
    if (!active || !richComposer) return;
    const editor = richBodyRef.current;
    if (!editor) return;
    cleanupEditorTypingFormatMarkers(editor);
    if (editor.dataset.skipAutoLink !== 'true') autoLinkEditorText(editor, { force: true });
    syncRichBodyFromEditor(editor.textContent ?? '', editor.innerHTML);
  }, [active, richComposer, cancelPendingRichBodySync, syncRichBodyFromEditor]);

  useLayoutEffect(() => {
    if (!flushPendingRef) return;
    flushPendingRef.current = flushRichBody;
    return () => { if (flushPendingRef.current === flushRichBody) flushPendingRef.current = null; };
  }, [flushPendingRef, flushRichBody]);

  // A supplied replacement draft or a deactivated editor invalidates any old
  // frame. Normal keystrokes remain batched until a frame or an action boundary.
  useLayoutEffect(() => cancelPendingRichBodySync, [
    active, draft.account_id, draft.draft_id, draft.body, draft.html_body, richComposer, cancelPendingRichBodySync,
  ]);

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
    // Register both kinds in the current composer session before awaiting any
    // image import. Otherwise a late completion can start files in a new draft.
    if (otherFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const syntheticEvent = {
        clipboardData: { files: otherFiles as unknown as FileList },
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as React.ClipboardEvent<HTMLTextAreaElement>;
      onAttachmentPaste(syntheticEvent);
    }
    if (imageFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      try {
        const attachments = await buildInlineImageAttachments(imageFiles);
        if (attachments.length === 0) return;
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
  }

  function handleRichBodyKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const editor = event.currentTarget;
    const nativeEvent = event.nativeEvent;
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;

    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (!event.shiftKey && (key === '[' || key === ']')) {
      event.preventDefault();
      event.stopPropagation();
      runEditorCommand(editor, key === ']' ? 'indent' : 'outdent');
      return;
    }
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

  useEffect(() => cancelPendingRichBodySync, [cancelPendingRichBodySync]);

  return (
    <div className="composer-primary-fields">
      <RecipientField
        label="收件人"
        placeholder="姓名或邮箱"
        value={draft.to}
        contactSearchEntries={contactSearchEntries}
        blockedEmails={blockedRecipientEmails.to}
        onChange={(value) => onPatchDraft({ to: value })}
        onFocus={() => onRecipientFieldFocus?.('to')}
        actions={(
          mobile ? <button
            type="button"
            className="composer-recipient-details-toggle"
            aria-label={ccOpen || bccOpen ? '收起抄送和密送' : '展开抄送和密送'}
            title="抄送和密送"
            aria-expanded={ccOpen || bccOpen}
            onClick={() => {
              const nextOpen = !(ccOpen || bccOpen);
              if (ccOpen !== nextOpen) onToggleCc?.();
              if (bccOpen !== nextOpen) onToggleBcc?.();
            }}
          >
            {ccOpen || bccOpen
              ? <ChevronUp size={20} strokeWidth={1.75} aria-hidden="true" />
              : <ChevronDown size={20} strokeWidth={1.75} aria-hidden="true" />}
          </button> : <>
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
          placeholder="姓名或邮箱"
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
          placeholder="姓名或邮箱"
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
            aria-keyshortcuts="Meta+] Meta+[ Control+] Control+["
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-gramm="false"
            onKeyDownCapture={handleRichBodyKeyDown}
            onInput={handleRichBodyInput}
            onCompositionEnd={handleRichBodyCompositionEnd}
            onBlur={flushRichBody}
            onPaste={handleRichBodyPaste}
            onDrop={onAttachmentDrop}
            onDragEnter={onAttachmentDragEnter}
            onDragLeave={onAttachmentDragLeave}
            onDragOver={onAttachmentDragOver}
          />
        ) : (
          <textarea
            aria-label="邮件正文"
            aria-keyshortcuts="Meta+] Meta+[ Control+] Control+["
            value={editableBody}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-gramm="false"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey
                && (event.key === '[' || event.key === ']')) {
                event.preventDefault();
                event.stopPropagation();
                indentPlainText(event.currentTarget, event.key === '[');
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
          <section ref={attachmentsRef} className="composer-body-attachments composer-attachment-list" aria-label="附件">
            {regularAttachments.map((attachment, visibleIndex) => {
              const iconMeta = attachmentIconMeta(attachment.filename, attachment.mime_type);
              const attachmentIndex = draft.attachments.indexOf(attachment);
              return (
                <article className={`composer-attachment-tile attachment-${iconMeta.tone}`} key={`${attachment.filename}-${attachmentIndex}`}>
                  <span className="composer-attachment-filemark" aria-hidden="true">
                    {iconMeta.icon}
                  </span>
                  <span className="composer-attachment-tile-copy">
                    <strong title={attachment.filename}>{attachment.filename}</strong>
                    <small>{formatBytes(attachment.size_bytes)} · {iconMeta.label.toUpperCase()}</small>
                  </span>
                  <button type="button" aria-label={`移除 ${attachment.filename}`} title={`移除 ${attachment.filename}`} onClick={(event) => {
                    if (document.activeElement === event.currentTarget) removalFocusRef.current = {
                      index: visibleIndex, composer: event.currentTarget.closest('.composer'), trigger: event.currentTarget,
                    };
                    onRemoveAttachment(attachmentIndex);
                  }}>
                    <X size={16} aria-hidden="true" />
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
