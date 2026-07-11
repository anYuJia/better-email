import { useMemo, useState } from 'react';
import type React from 'react';
import { File, FileArchive, FileImage, FileSpreadsheet, FileText, X } from 'lucide-react';
import type { Contact, DraftInput } from '../../app/types';
import { formatBytes } from '../../mailUtils';

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

const originalMessageMarkerPattern = /\n{0,2}-{2,}\s*(?:原始邮件|original message|forwarded message)\s*-{2,}[\s\S]*$/i;
const originalMessageMetaPattern = /^\s*(?:发件人|收件人|抄送|时间|日期|主题|from|to|cc|date|subject)\s*[:：]/i;

function splitEditableBody(body: string) {
  const match = body.match(originalMessageMarkerPattern);
  if (!match || match.index === undefined) {
    return { editableBody: body, originalQuote: '' };
  }
  return {
    editableBody: body.slice(0, match.index).trimEnd(),
    originalQuote: body.slice(match.index).trimStart(),
  };
}

function joinEditableBody(editableBody: string, originalQuote: string) {
  if (!originalQuote) return editableBody;
  const trimmedEditable = editableBody.trimEnd();
  return `${trimmedEditable}${trimmedEditable ? '\n\n' : ''}${originalQuote}`;
}

function stripQuotePrefix(line: string) {
  return line.replace(/^\s*(?:>\s*)+/, '').trimEnd();
}

function parseOriginalQuote(originalQuote: string) {
  const lines = originalQuote.replace(/\r\n?/g, '\n').split('\n');
  const [, ...rest] = lines;
  const meta: string[] = [];
  const content: string[] = [];
  let sawContent = false;

  for (const line of rest) {
    if (!sawContent && originalMessageMetaPattern.test(line)) {
      meta.push(line.trim());
      continue;
    }
    if (!sawContent && !line.trim()) {
      continue;
    }
    sawContent = true;
    content.push(stripQuotePrefix(line));
  }

  return {
    meta,
    content: content.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

function ComposerOriginalQuote({ originalQuote }: { originalQuote: string }) {
  const quote = parseOriginalQuote(originalQuote);

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

function attachmentIcon(filename: string, mimeType: string) {
  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(lowerName)) {
    return <FileImage size={25} />;
  }
  if (/\.(xlsx?|csv|numbers)$/i.test(lowerName)) {
    return <FileSpreadsheet size={25} />;
  }
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lowerName)) {
    return <FileArchive size={25} />;
  }
  if (lowerMime.startsWith('text/') || /\.(pdf|txt|md|docx?|pages)$/i.test(lowerName)) {
    return <FileText size={25} />;
  }
  return <File size={25} />;
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
  const recipientQuery = draft.to.split(/[;,]/).pop()?.trim().toLowerCase() ?? '';
  const suggestedContacts = useMemo(() => {
    const pool = recipientQuery
      ? contacts.filter((contact) => {
          const name = contact.name.toLowerCase();
          const email = contact.email.toLowerCase();
          return name.includes(recipientQuery)
            || email.includes(recipientQuery)
            || contact.aliases.some((alias) => alias.toLowerCase().includes(recipientQuery));
        })
      : contacts;
    return pool.slice(0, 5);
  }, [contacts, recipientQuery]);
  const { editableBody, originalQuote } = splitEditableBody(draft.body);

  return (
    <div className="composer-primary-fields">
      <div className="composer-recipient-field">
        <label className="composer-field-row">
          <span>收件人</span>
          <input
            value={draft.to}
            onChange={(event) => onPatchDraft({ to: event.target.value })}
            onFocus={() => setRecipientFocused(true)}
            onBlur={() => window.setTimeout(() => setRecipientFocused(false), 120)}
            placeholder="收件人"
          />
        </label>

        {recipientFocused && suggestedContacts.length > 0 && (
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
          <section className="composer-body-attachments" aria-label="附件">
            {draft.attachments.map((attachment, index) => (
              <article className="composer-attachment-tile" key={`${attachment.filename}-${index}`}>
                <span className="composer-attachment-tile-icon" aria-hidden="true">
                  {attachmentIcon(attachment.filename, attachment.mime_type)}
                </span>
                <span className="composer-attachment-tile-copy">
                  <strong>{attachment.filename}</strong>
                  <small>{formatBytes(attachment.size_bytes)}</small>
                </span>
                <button type="button" aria-label={`移除 ${attachment.filename}`} onClick={() => onRemoveAttachment(index)}>
                  <X size={14} />
                </button>
              </article>
            ))}
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
