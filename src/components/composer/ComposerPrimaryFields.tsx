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
  return (
    <div className="composer-primary-fields">
      <label className="composer-field-row">
        <span>收件人</span>
        <input
          list="contact-suggestions"
          value={draft.to}
          onChange={(event) => onPatchDraft({ to: event.target.value })}
          placeholder="收件人"
        />
      </label>

      {contacts.length > 0 && (
        <div className="recipient-suggestions">
          <span>常用联系人</span>
          {contacts.slice(0, 5).map((contact) => (
            <button type="button" key={contact.id} onClick={() => onAddContact(contact)}>
              <strong>{contact.vip ? '★ ' : ''}{contact.name || contact.email}</strong>
              <small>{contact.email}{contact.aliases.length ? ` · ${contact.aliases.length} 个别名` : ''}</small>
            </button>
          ))}
        </div>
      )}

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
