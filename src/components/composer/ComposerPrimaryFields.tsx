import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, X } from 'lucide-react';
import type { Contact, DraftInput } from '../../app/types';
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
}: ComposerPrimaryFieldsProps) {
  const [recipientFocused, setRecipientFocused] = useState(false);
  const recipientBlurTimerRef = useRef<number | null>(null);
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
  const showRecipientSuggestions = suggestedContacts.length > 0 && (recipientFocused || !draft.to.trim());
  const { editableBody, originalQuote } = useMemo(
    () => splitEditableBody(draft.body),
    [draft.body],
  );

  const clearRecipientBlurTimer = () => {
    if (recipientBlurTimerRef.current === null) return;
    window.clearTimeout(recipientBlurTimerRef.current);
    recipientBlurTimerRef.current = null;
  };

  useEffect(() => () => {
    clearRecipientBlurTimer();
  }, []);

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
        {draft.attachments.length > 0 && (
          <section className="composer-body-attachments composer-attachment-list" aria-label="附件">
            {draft.attachments.map((attachment, index) => {
              const iconMeta = attachmentIconMeta(attachment.filename, attachment.mime_type);
              return (
                <article className={`composer-attachment-tile attachment-${iconMeta.tone}`} key={`${attachment.filename}-${index}`}>
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
                  <button type="button" aria-label={`移除 ${attachment.filename}`} onClick={() => onRemoveAttachment(index)}>
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
