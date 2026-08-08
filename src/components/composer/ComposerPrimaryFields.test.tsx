import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Contact, DraftInput } from '../../app/types';
import ComposerPrimaryFields from './ComposerPrimaryFields';
import { localFileAssetUrl } from '../../tauriBridge';

vi.mock('../../tauriBridge', () => ({
  localFileAssetUrl: vi.fn(),
}));

const mockLocalFileAssetUrl = vi.mocked(localFileAssetUrl);

const ada: Contact = {
  id: 1,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  aliases: [],
  vip: false,
  message_count: 0,
  last_seen_at: '',
};

function draft(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    draft_id: 0,
    account_id: 1,
    identity_id: 0,
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    html_body: '',
    send_at: '',
    attachments: [],
    ...overrides,
  };
}

function renderFields(
  input: DraftInput,
  richComposer = true,
  onPatchDraft = vi.fn(),
) {
  const result = render(
    <ComposerPrimaryFields
      draft={input}
      contacts={[ada]}
      richComposer={richComposer}
      dropActive={false}
      onPatchDraft={onPatchDraft}
      onAddContact={vi.fn()}
      onPickAttachments={vi.fn()}
      onRemoveAttachment={vi.fn()}
      onAttachmentDrop={vi.fn()}
      onAttachmentDragEnter={vi.fn()}
      onAttachmentDragLeave={vi.fn()}
      onAttachmentDragOver={vi.fn()}
      onAttachmentPaste={vi.fn()}
      buildInlineImageAttachments={vi.fn(async () => [])}
      onInlineImagesAdded={vi.fn()}
    />,
  );
  return { ...result, onPatchDraft };
}

describe('ComposerPrimaryFields', () => {
  afterEach(() => {
    cleanup();
    mockLocalFileAssetUrl.mockReset();
  });

  it('uses the app-controlled contact menu instead of a native datalist', () => {
    const { container } = renderFields(draft());
    const recipient = screen.getByPlaceholderText('收件人');

    expect(recipient.getAttribute('list')).toBeNull();
    expect(recipient.getAttribute('autocomplete')).toBe('off');
    expect(container.querySelector('datalist')).toBeNull();

    fireEvent.focus(recipient);
    expect(screen.getByText('常用联系人')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Ada Lovelace/ })).not.toBeNull();
  });

  it('keeps common contacts available for an unmatched fragment and replaces that fragment on selection', () => {
    const { onPatchDraft } = renderFields(draft({ to: '22' }));
    const recipient = screen.getByPlaceholderText('收件人');

    fireEvent.focus(recipient);
    expect(screen.getByText('常用联系人')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));

    expect(onPatchDraft).toHaveBeenCalledWith({ to: 'ada@example.com' });
  });

  it('renders the cc field between recipients and subject', () => {
    const { container, onPatchDraft } = renderFields(draft({ cc: 'team@example.com' }));
    const cc = screen.getByPlaceholderText('抄送（可选）');

    expect((cc as HTMLInputElement).value).toBe('team@example.com');
    fireEvent.change(cc, { target: { value: 'design@example.com' } });
    expect(onPatchDraft).toHaveBeenCalledWith({ cc: 'design@example.com' });

    const rows = Array.from(container.querySelectorAll('.composer-field-row'));
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual(['收件人', '抄送', '主题']);
  });

  it('replaces a pasted image CID with its local asset URL for editor preview', async () => {
    mockLocalFileAssetUrl.mockResolvedValue('asset://localhost/temp_attachments/image.png');
    const { container } = renderFields(draft({
      html_body: '<img src="cid:inline-test@better-email.local" alt="image.png">',
      attachments: [{
        filename: 'image.png',
        mime_type: 'image/png',
        size_bytes: 12,
        local_path: '/appdata/temp_attachments/image.png',
        content_id: 'inline-test@better-email.local',
        is_inline: true,
      }],
    }), true);

    const image = await waitFor(() => {
      const nextImage = container.querySelector<HTMLImageElement>('.composer-richtext-body img');
      expect(nextImage).not.toBeNull();
      expect(nextImage?.getAttribute('src')).toBe('asset://localhost/temp_attachments/image.png');
      return nextImage;
    });

    expect(image?.getAttribute('alt')).toBe('image.png');
    expect(mockLocalFileAssetUrl).toHaveBeenCalledWith('/appdata/temp_attachments/image.png');
  });

  it('hydrates the rich editor from a plain-text draft without treating it as markup', async () => {
    const { container } = renderFields(draft({ body: 'Hello <team>\nNext line' }));
    const editor = await waitFor(() => {
      const nextEditor = container.querySelector<HTMLElement>('.composer-richtext-body');
      expect(nextEditor).not.toBeNull();
      return nextEditor;
    });

    expect(editor?.innerHTML).toBe('Hello &lt;team&gt;<br>Next line');
  });
});
