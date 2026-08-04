import type { ComposerAutosave, ComposeTemplate, DraftInput, MailIdentityInput } from './types';
import { composeTemplatesStorageKey, composerAutosaveStorageKey, readAppStorage } from './storageConfig';

export { composeTemplatesStorageKey, composerAutosaveStorageKey };

export const emptyDraft: DraftInput = {
  draft_id: 0,
  account_id: 0,
  identity_id: 0,
  to: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  html_body: '',
  send_at: '',
  attachments: [],
  in_reply_to: '',
  references: '',
};

export const emptyIdentityForm: MailIdentityInput = {
  id: 0,
  account_id: 0,
  name: '',
  email: '',
  reply_to: '',
  signature: '',
  is_default: false,
};

export function loadComposeTemplates(): ComposeTemplate[] {
  try {
    const stored = readAppStorage(composeTemplatesStorageKey);
    const parsed = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === 'string')
      .map((item) => {
        const id = typeof item.id === 'string' ? item.id : crypto.randomUUID();
        const now = new Date().toISOString();
        return {
          id,
          name: item.name,
          subject: typeof item.subject === 'string' ? item.subject : '',
          body: typeof item.body === 'string' ? item.body : '',
          html_body: typeof item.html_body === 'string' ? item.html_body : '',
          category: typeof item.category === 'string' ? item.category : '',
          tags: Array.isArray(item.tags)
            ? item.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
            : [],
          account_id: typeof item.account_id === 'number' ? item.account_id : 0,
          is_favorite: item.is_favorite === true,
          created_at: typeof item.created_at === 'string' ? item.created_at : now,
          updated_at: typeof item.updated_at === 'string' ? item.updated_at : now,
        };
      })
      .filter((item) => item.name.trim() && (item.subject.trim() || item.body.trim() || item.html_body.trim()));
  } catch {
    return [];
  }
}


export function isDraftEmpty(input: DraftInput): boolean {
  return (
    !input.to.trim()
    && !input.cc.trim()
    && !input.bcc.trim()
    && !input.subject.trim()
    && !input.body.trim()
    && !input.html_body.trim()
    && input.attachments.length === 0
  );
}

export function normalizeDraftInput(value: unknown): DraftInput | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<DraftInput>;
  const attachments = Array.isArray(item.attachments)
    ? item.attachments.filter(
      (attachment) =>
        attachment &&
        typeof attachment.filename === 'string' &&
        typeof attachment.mime_type === 'string' &&
        typeof attachment.size_bytes === 'number' &&
        typeof attachment.local_path === 'string',
    )
    : [];
  return {
    draft_id: Number(item.draft_id) || 0,
    account_id: Number(item.account_id) || 0,
    identity_id: Number(item.identity_id) || 0,
    to: typeof item.to === 'string' ? item.to : '',
    cc: typeof item.cc === 'string' ? item.cc : '',
    bcc: typeof item.bcc === 'string' ? item.bcc : '',
    subject: typeof item.subject === 'string' ? item.subject : '',
    body: typeof item.body === 'string' ? item.body : '',
    html_body: typeof item.html_body === 'string' ? item.html_body : '',
    send_at: typeof item.send_at === 'string' ? item.send_at : '',
    attachments,
    in_reply_to: typeof item.in_reply_to === 'string' ? item.in_reply_to : '',
    references: typeof item.references === 'string' ? item.references : '',
  };
}

export function loadComposerAutosave(): ComposerAutosave | null {
  try {
    const stored = readAppStorage(composerAutosaveStorageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const draft = normalizeDraftInput(parsed?.draft);
    if (!draft || isDraftEmpty(draft)) return null;
    return {
      draft,
      isRichComposer: Boolean(parsed?.isRichComposer),
      saved_at: typeof parsed?.saved_at === 'string' ? parsed.saved_at : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
