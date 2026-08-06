import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, X } from 'lucide-react';
import type { Contact, DraftInput, OutboundAttachmentInput } from '../../app/types';
import { formatBytes } from '../../mailUtils';
import {
  buildContactSearchEntries,
  datalistContacts as pickDatalistContacts,
  matchingContacts,
} from './contactSuggestions';
import {
  joinEditableBody,
  parseOriginalQuote,
  splitEditableBody,
} from './composerBody';
import { normalizeContentId } from '../../app/inlineImages';
import { localFileAssetUrl } from '../../tauriBridge';

type ComposerPrimaryFieldsProps = {
  draft: DraftInput;
  contacts: Contact[];
  richComposer: boolean;
  dropActive: boolean;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
  onAddContact: (contact: Contact) => void;
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

const datalistContactLimit = 30;
const inlineSuggestionLimit = 5;

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
  onPatchDraft,
  onAddContact,
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
  const [recipientFocused, setRecipientFocused] = useState(false);
  const recipientBlurTimerRef = useRef<number | null>(null);
  const richBodyRef = useRef<HTMLDivElement>(null);
  const hydratedInlineSrcRef = useRef<Map<string, string>>(new Map());
  const recipientQuery = draft.to.split(/[;,]/).pop()?.trim().toLowerCase() ?? '';
  const contactSearchEntries = useMemo(
    () => buildContactSearchEntries(contacts),
    [contacts],
  );
  const suggestedContacts = useMemo(
    () => matchingContacts(contactSearchEntries, recipientQuery, inlineSuggestionLimit),
    [contactSearchEntries, recipientQuery],
  );
  const datalistContacts = useMemo(() => (
    pickDatalistContacts(
      contactSearchEntries,
      recipientQuery,
      suggestedContacts,
      datalistContactLimit,
    )
  ), [contactSearchEntries, recipientQuery, suggestedContacts]);
  const showRecipientSuggestions = suggestedContacts.length > 0 && recipientFocused;
  const { editableBody, originalQuote } = useMemo(
    () => splitEditableBody(draft.body),
    [draft.body],
  );
  const regularAttachments = useMemo(
    () => draft.attachments.filter((attachment) => !attachment.is_inline),
    [draft.attachments],
  );

  useEffect(() => {
    if (!richComposer) return;
    const editor = richBodyRef.current;
    if (!editor) return;
    if (document.activeElement === editor) return;
    if (editor.innerHTML !== draft.html_body) {
      editor.innerHTML = draft.html_body;
    }
  }, [draft.html_body, richComposer]);

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

  const clearRecipientBlurTimer = () => {
    if (recipientBlurTimerRef.current === null) return;
    window.clearTimeout(recipientBlurTimerRef.current);
    recipientBlurTimerRef.current = null;
  };

  useEffect(() => () => {
    clearRecipientBlurTimer();
  }, []);

  function syncRichBodyFromEditor() {
    const editor = richBodyRef.current;
    if (!editor) return;
    const hydrated = hydratedInlineSrcRef.current;
    const hydratedImages: Array<{ img: HTMLImageElement; cid: string }> = [];
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
    const html = editor.innerHTML;
    for (const { img, cid } of hydratedImages) {
      const assetUrl = hydrated.get(cid);
      if (assetUrl) img.setAttribute('src', assetUrl);
    }
    onPatchDraft({
      html_body: html,
      body: joinEditableBody(editor.innerText, originalQuote),
    });
  }

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
    syncRichBodyFromEditor();
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
        console.error(error);
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

  function handleRichBodyInput() {
    syncRichBodyFromEditor();
  }

  return (
    <div className="composer-primary-fields">
      <div className="composer-recipient-field">
        <label className="composer-field-row">
          <span>收件人</span>
          <input
            list="contact-suggestions"
            value={draft.to}
            onChange={(event) => onPatchDraft({ to: event.target.value })}
            onFocus={() => {
              clearRecipientBlurTimer();
              setRecipientFocused(true);
            }}
            onBlur={() => {
              clearRecipientBlurTimer();
              recipientBlurTimerRef.current = window.setTimeout(() => {
                recipientBlurTimerRef.current = null;
                setRecipientFocused(false);
              }, 120);
            }}
            placeholder="收件人"
          />
        </label>
        <datalist id="contact-suggestions">
          {datalistContacts.map((contact) => (
            <option key={contact.id} value={contact.email}>
              {contact.name || contact.email}
            </option>
          ))}
        </datalist>

        {showRecipientSuggestions && (
          <div className="recipient-suggestions">
            <span>{recipientQuery ? '匹配联系人' : '常用联系人'}</span>
            {suggestedContacts.map((contact) => (
              <button type="button" key={contact.id} onMouseDown={(event) => event.preventDefault()} onClick={() => onAddContact(contact)}>
                <strong>{contact.name || contact.email}</strong>
                <small>{contact.email}</small>
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="composer-field-row">
        <span>主题</span>
        <input
          value={draft.subject}
          onChange={(event) => onPatchDraft({ subject: event.target.value })}
          placeholder="主题"
        />
      </label>

      <label
        className={`composer-body-field${originalQuote ? ' has-original-quote' : ''}${dropActive ? ' drop-active' : ''}`}
        onDrop={onAttachmentDrop}
        onDragEnter={onAttachmentDragEnter}
        onDragLeave={onAttachmentDragLeave}
        onDragOver={onAttachmentDragOver}
      >
        <span className="sr-only">正文</span>
        {richComposer ? (
          <div
            ref={richBodyRef}
            className="composer-richtext-body"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="正文"
            role="textbox"
            aria-multiline="true"
            aria-label="正文（富文本）"
            onInput={handleRichBodyInput}
            onPaste={handleRichBodyPaste}
            onDrop={onAttachmentDrop}
            onDragEnter={onAttachmentDragEnter}
            onDragLeave={onAttachmentDragLeave}
            onDragOver={onAttachmentDragOver}
          />
        ) : (
          <textarea
            value={editableBody}
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
            placeholder="正文"
          />
        )}
        {regularAttachments.length > 0 && (
          <section className="composer-body-attachments composer-attachment-list" aria-label="附件">
            {regularAttachments.map((attachment) => {
              const iconMeta = attachmentIconMeta(attachment.filename, attachment.mime_type);
              const attachmentIndex = draft.attachments.indexOf(attachment);
              return (
                <article className={`composer-attachment-tile attachment-${iconMeta.tone}`} key={`${attachment.filename}-${attachmentIndex}`}>
                  <span className="composer-attachment-filemark" aria-hidden="true">
                    <span className="composer-attachment-filemark-fold" />
                    <span className="composer-attachment-filemark-icon">
                      {iconMeta.icon}
                    </span>
                    <span className="composer-attachment-filemark-label">{iconMeta.label}</span>
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
      </label>
    </div>
  );
}
