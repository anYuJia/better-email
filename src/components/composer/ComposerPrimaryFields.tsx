import { useMemo, useState } from 'react';
import type { Contact, DraftInput } from '../../app/types';

type ComposerPrimaryFieldsProps = {
  draft: DraftInput;
  contacts: Contact[];
  richComposer: boolean;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
  onAddContact: (contact: Contact) => void;
};

export default function ComposerPrimaryFields({
  draft,
  contacts,
  richComposer,
  onPatchDraft,
  onAddContact,
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

      <label className="composer-body-field">
        <span className="sr-only">正文</span>
        <textarea
          value={draft.body}
          onChange={(event) => onPatchDraft({
            body: event.target.value,
            html_body: richComposer
              ? `<p>${event.target.value.replace(/\n/g, '<br>')}</p>`
              : draft.html_body,
          })}
          placeholder="正文"
        />
      </label>
    </div>
  );
}
