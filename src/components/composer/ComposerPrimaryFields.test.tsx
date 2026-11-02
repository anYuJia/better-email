import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cloneElement, useState } from 'react';
import type { Contact, DraftInput } from '../../app/types';
import ComposerPrimaryFields from './ComposerPrimaryFields';
import { localFileAssetUrl } from '../../tauriBridge';

vi.mock('../../tauriBridge', () => ({
  localFileAssetUrl: vi.fn(),
}));

const mockLocalFileAssetUrl = vi.mocked(localFileAssetUrl);
afterEach(cleanup);

const ada: Contact = {
  id: 1,
  account_id: 1,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  aliases: [],
  vip: false,
  message_count: 0,
  last_seen_at: '',
};

const adaWu: Contact = {
  id: 2,
  account_id: 1,
  name: 'Ada Wu',
  email: 'ada.wu@example.com',
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
  contacts: Contact[] = [ada],
) {
  const view = (
    <ComposerPrimaryFields
      draft={input}
      contacts={contacts}
      richComposer={richComposer}
      dropActive={false}
      onPatchDraft={onPatchDraft}
      onPickAttachments={vi.fn()}
      onRemoveAttachment={vi.fn()}
      onAttachmentDrop={vi.fn()}
      onAttachmentDragEnter={vi.fn()}
      onAttachmentDragLeave={vi.fn()}
      onAttachmentDragOver={vi.fn()}
      onAttachmentPaste={vi.fn()}
      buildInlineImageAttachments={vi.fn(async () => [])}
      onInlineImagesAdded={vi.fn()}
    />
  );
  const result = render(view);
  return { ...result, onPatchDraft, view };
}

function recipientInput(container: HTMLElement, index = 0) {
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('.composer-recipient-editor input'));
  return inputs[index];
}

it('keeps keyboard focus in the attachment workflow after removing files', () => {
  const attachments = ['first.txt', 'second.txt'].map(filename => ({ filename, mime_type: 'text/plain', size_bytes: 12, local_path: `/tmp/${filename}` }));
  const initial = draft({ attachments });
  const { view, unmount } = renderFields(initial);
  unmount();
  function Harness() {
    const [current, setCurrent] = useState(initial);
    return <section className="composer">
      {cloneElement(view, { draft: current, onRemoveAttachment: (index: number) => setCurrent(prev => ({
        ...prev, attachments: prev.attachments.filter((_, item) => item !== index),
      })) })}
      <button aria-label="添加附件">附件</button>
    </section>;
  }
  render(<Harness />);
  const first = screen.getByRole('button', { name: '移除 first.txt' });
  first.focus();
  fireEvent.click(first);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '移除 second.txt' }));
  fireEvent.click(document.activeElement!);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '添加附件' }));
});

function ControlledComposerFields({ initialDraft }: { initialDraft: DraftInput }) {
  const [currentDraft, setCurrentDraft] = useState(initialDraft);
  return (
    <ComposerPrimaryFields
      draft={currentDraft}
      contacts={[ada, adaWu]}
      richComposer
      dropActive={false}
      onPatchDraft={(patch) => setCurrentDraft((current) => ({ ...current, ...patch }))}
      onPickAttachments={vi.fn()}
      onRemoveAttachment={vi.fn()}
      onAttachmentDrop={vi.fn()}
      onAttachmentDragEnter={vi.fn()}
      onAttachmentDragLeave={vi.fn()}
      onAttachmentDragOver={vi.fn()}
      onAttachmentPaste={vi.fn()}
      buildInlineImageAttachments={vi.fn(async () => [])}
      onInlineImagesAdded={vi.fn()}
    />
  );
}

describe('ComposerPrimaryFields', () => {
  afterEach(() => {
    cleanup();
    mockLocalFileAssetUrl.mockReset();
  });

  it('uses the app-controlled contact menu only after a query is entered', () => {
    const { container } = renderFields(draft());
    const recipient = screen.getByRole('combobox', { name: '收件人' });

    expect(recipient.getAttribute('list')).toBeNull();
    expect(recipient.getAttribute('autocomplete')).toBe('off');
    expect(container.querySelector('datalist')).toBeNull();

    fireEvent.focus(recipient);
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(recipient, { target: { value: 'ada' } });
    expect(screen.getByText('匹配联系人')).not.toBeNull();
    expect(screen.getByRole('listbox', { name: '收件人匹配联系人' })).not.toBeNull();
    expect(screen.getByRole('option', { name: /Ada Lovelace/ })).not.toBeNull();
  });

  it('only suggests contacts once the query matches, and commits on Enter', () => {
    const { onPatchDraft } = renderFields(draft());
    const recipient = screen.getByRole('combobox', { name: '收件人' });

    fireEvent.focus(recipient);
    fireEvent.change(recipient, { target: { value: '225' } });
    expect(screen.queryByText('匹配联系人')).toBeNull();

    fireEvent.change(recipient, { target: { value: 'ada' } });
    fireEvent.keyDown(recipient, { key: 'Enter' });

    expect(onPatchDraft).toHaveBeenLastCalledWith({ to: 'ada@example.com' });
  });

  it('navigates suggestions with arrow keys before committing', () => {
    const { onPatchDraft } = renderFields(draft(), true, vi.fn(), [ada, adaWu]);
    const recipient = screen.getByRole('combobox', { name: '收件人' });

    fireEvent.change(recipient, { target: { value: 'ada' } });
    fireEvent.keyDown(recipient, { key: 'ArrowDown' });
    fireEvent.keyDown(recipient, { key: 'Enter' });

    expect(onPatchDraft).toHaveBeenLastCalledWith({ to: 'ada.wu@example.com' });
  });

  it('shows four matches and keeps Tab as a literal character while arrows navigate suggestions', () => {
    const contacts = Array.from({ length: 5 }, (_, index) => ({
      ...ada,
      id: index + 10,
      name: `Wang ${index + 1}`,
      email: `wang${index + 1}@example.com`,
    }));
    const onPatchDraft = vi.fn();
    renderFields(draft(), true, onPatchDraft, contacts);
    const recipient = screen.getByRole('combobox', { name: '收件人' });

    fireEvent.focus(recipient);
    fireEvent.change(recipient, { target: { value: 'wang' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(4);
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    (recipient as HTMLInputElement).setSelectionRange(4, 4);
    expect(fireEvent.keyDown(recipient, { key: 'Tab' })).toBe(false);
    expect((recipient as HTMLInputElement).value).toBe('wang\t');
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    // 建议导航只由 ArrowUp/ArrowDown 驱动。
    fireEvent.keyDown(recipient, { key: 'ArrowDown' });
    expect(options[1].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(recipient, { key: 'ArrowUp' });
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(recipient, { key: 'ArrowDown' });
    fireEvent.keyDown(recipient, { key: 'Enter' });
    expect(onPatchDraft).toHaveBeenLastCalledWith({ to: 'wang2@example.com' });
  });

  it('turns a committed recipient into a chip removable as a whole', () => {
    const { container, onPatchDraft } = renderFields(draft());
    const recipient = screen.getByRole('combobox', { name: '收件人' });

    fireEvent.change(recipient, { target: { value: 'ada' } });
    fireEvent.keyDown(recipient, { key: 'Enter' });

    const chip = container.querySelector('.composer-recipient-chip');
    expect(chip?.textContent).toContain('Ada Lovelace');
    expect(screen.getByLabelText('移除 ada@example.com')).not.toBeNull();

    fireEvent.click(screen.getByLabelText('移除 ada@example.com'));
    expect(onPatchDraft).toHaveBeenLastCalledWith({ to: '' });
  });

  it('removes the last chip with Backspace on an empty input', () => {
    const { container, onPatchDraft } = renderFields(draft());
    const recipient = screen.getByRole('combobox', { name: '收件人' });

    fireEvent.change(recipient, { target: { value: 'ada' } });
    fireEvent.keyDown(recipient, { key: 'Enter' });

    fireEvent.keyDown(recipientInput(container), { key: 'Backspace' });
    expect(onPatchDraft).toHaveBeenLastCalledWith({ to: '' });
  });

  it('supports multiple recipients as separate chips', () => {
    const { container, onPatchDraft } = renderFields(draft(), true, vi.fn(), [ada, adaWu]);
    const recipient = screen.getByRole('combobox', { name: '收件人' });

    fireEvent.change(recipient, { target: { value: 'ada' } });
    fireEvent.keyDown(recipient, { key: 'Enter' });

    const editorInput = recipientInput(container);
    fireEvent.change(editorInput, { target: { value: 'ada.wu' } });
    fireEvent.keyDown(editorInput, { key: 'Enter' });

    expect(onPatchDraft).toHaveBeenLastCalledWith({ to: 'ada@example.com, ada.wu@example.com' });
    expect(container.querySelectorAll('.composer-recipient-chip')).toHaveLength(2);
  });

  it('preserves display names from formatted recipient addresses in chips', () => {
    const { container } = renderFields(draft({
      to: '崔栗嘉 <lij140@chinatelecom.cn>, 代琴 <daiqin@chinatelecom.cn>',
    }), true, vi.fn(), []);

    const chips = [...container.querySelectorAll('.composer-recipient-chip-copy')].map((item) => item.textContent);
    expect(chips).toEqual(['崔栗嘉', '代琴']);
  });

  it('removes only the clicked chip when the draft is parent-controlled', () => {
    const { container } = render(
      <ControlledComposerFields
        initialDraft={draft({ to: 'first@example.com, second@example.com, last@example.com' })}
      />,
    );

    fireEvent.click(screen.getByLabelText('移除 last@example.com'));

    expect(screen.queryByLabelText('移除 last@example.com')).toBeNull();
    expect(container.querySelectorAll('.composer-recipient-chip')).toHaveLength(2);
    expect(screen.getByLabelText('移除 first@example.com')).not.toBeNull();
    expect(screen.getByLabelText('移除 second@example.com')).not.toBeNull();
  });

  it('commits a fully typed address as a chip on blur', () => {
    const { container, onPatchDraft } = renderFields(draft());
    const recipient = screen.getByRole('combobox', { name: '收件人' });

    fireEvent.change(recipient, { target: { value: 'new@example.com' } });
    fireEvent.blur(recipient);

    expect(onPatchDraft).toHaveBeenLastCalledWith({ to: 'new@example.com' });
    expect(container.querySelectorAll('.composer-recipient-chip')).toHaveLength(1);
  });

  it('offers contact suggestions in the cc field', () => {
    const { onPatchDraft } = renderFields(draft());
    const cc = screen.getByRole('combobox', { name: '抄送' });

    fireEvent.focus(cc);
    expect(screen.queryByText('匹配联系人')).toBeNull();

    fireEvent.change(cc, { target: { value: 'ada' } });
    fireEvent.keyDown(cc, { key: 'Enter' });
    expect(onPatchDraft).toHaveBeenLastCalledWith({ cc: 'ada@example.com' });
  });

  it('renders the cc field between recipients and subject', () => {
    const { container, onPatchDraft } = renderFields(draft({ cc: 'team@example.com' }));

    expect(container.querySelectorAll('.composer-recipient-chip')[0]?.textContent).toContain('team@example.com');
    const cc = recipientInput(container, 1);
    expect(cc.value).toBe('');
    fireEvent.change(cc, { target: { value: 'design@example.com' } });
    fireEvent.keyDown(cc, { key: 'Enter' });
    expect(onPatchDraft).toHaveBeenCalledWith({ cc: 'team@example.com, design@example.com' });

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

  it('keeps hydrated image and text nodes when reactivating the same draft, but applies a changed draft', async () => {
    mockLocalFileAssetUrl.mockResolvedValue('asset://localhost/retained-image.png');
    const original = draft({
      html_body: '<p>继续编辑</p><img src="cid:retained-image">',
      attachments: [{ filename: 'image.png', mime_type: 'image/png', size_bytes: 12,
        local_path: '/retained-image.png', content_id: 'retained-image', is_inline: true }],
    });
    const { container, rerender, view, onPatchDraft } = renderFields(original);
    const editor = container.querySelector('.composer-richtext-body') as HTMLElement;
    const text = editor.querySelector('p')!.firstChild;
    const image = editor.querySelector('img')!;
    await waitFor(() => expect(image.getAttribute('src')).toBe('asset://localhost/retained-image.png'));
    const setImageAttribute = vi.spyOn(image, 'setAttribute');
    fireEvent.blur(editor);
    expect(onPatchDraft).toHaveBeenLastCalledWith({ body: '继续编辑', html_body: original.html_body });
    onPatchDraft.mockClear();
    fireEvent.blur(editor);
    expect(onPatchDraft).not.toHaveBeenCalled();
    expect(setImageAttribute).not.toHaveBeenCalled();
    expect(image.getAttribute('src')).toBe('asset://localhost/retained-image.png');
    rerender(cloneElement(view, { active: false }));
    rerender(cloneElement(view, { active: true }));
    expect(editor.querySelector('p')!.firstChild).toBe(text);
    expect(editor.querySelector('img')).toBe(image);
    expect(image.getAttribute('src')).toBe('asset://localhost/retained-image.png');
    const changed = { ...original, html_body: '<p>新模板正文</p>' };
    rerender(cloneElement(view, { active: false, draft: changed }));
    expect(editor.querySelector('p')!.firstChild).toBe(text);
    rerender(cloneElement(view, { active: true, draft: changed }));
    expect(editor.textContent).toBe('新模板正文');
    expect(editor.querySelector('img')).toBeNull();
  });

  it('hydrates a newly recreated rich editor after switching out of plain text', () => {
    const { container, rerender, view } = renderFields(draft({ body: '继续编辑', html_body: '<p>继续编辑</p>' }));
    rerender(cloneElement(view, { richComposer: false }));
    rerender(cloneElement(view, { richComposer: true }));
    expect(container.querySelector('.composer-richtext-body')?.textContent).toBe('继续编辑');
  });

  it('cancels the pending input frame on blur so it cannot overwrite a newer draft', () => {
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((next: FrameRequestCallback) => { callback = next; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    try {
      const { container, rerender, view, onPatchDraft } = renderFields(draft());
      const editor = container.querySelector('.composer-richtext-body') as HTMLElement;
      editor.innerHTML = '待同步的旧编辑';
      fireEvent.input(editor);
      expect(onPatchDraft).not.toHaveBeenCalled();
      fireEvent.blur(editor);
      expect(onPatchDraft).toHaveBeenCalledTimes(1);
      expect(cancelAnimationFrame).toHaveBeenCalled();
      onPatchDraft.mockClear();
      rerender(cloneElement(view, { draft: draft({ body: '新的草稿', html_body: '<p>新的草稿</p>' }) }));
      act(() => callback?.(0));
      expect(editor.textContent).toBe('新的草稿');
      expect(onPatchDraft).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
