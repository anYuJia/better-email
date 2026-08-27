import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import RecipientField from './RecipientField';
import type { ContactSearchEntry } from './contactSuggestions';

afterEach(() => {
  cleanup();
});

const contacts: ContactSearchEntry[] = [
  { contact: { id: 1, name: 'Ada Chen', email: 'ada@example.com', aliases: [], vip: false, message_count: 0, last_seen_at: '' }, searchText: 'ada@example.com ada chen' },
  { contact: { id: 2, name: 'Bob Lin', email: 'bob@example.com', aliases: [], vip: false, message_count: 0, last_seen_at: '' }, searchText: 'bob@example.com bob lin' },
  { contact: { id: 3, name: 'Carol Wu', email: 'carol@example.com', aliases: [], vip: false, message_count: 0, last_seen_at: '' }, searchText: 'carol@example.com carol wu' },
];

function renderField(onChange = vi.fn()) {
  return render(
    <div>
      <RecipientField
        label="收件人"
        placeholder="输入收件人"
        value=""
        contactSearchEntries={contacts}
        onChange={onChange}
      />
      <input aria-label="下一个输入框" />
    </div>,
  );
}

function recipientInput(): HTMLInputElement {
  return screen.getByLabelText('收件人') as HTMLInputElement;
}

async function openSuggestions(input: HTMLInputElement) {
  input.focus();
  fireEvent.change(input, { target: { value: 'ada' } });
  await act(async () => {});
}

describe('RecipientField keyboard', () => {
  it('exposes the input as an owned list autocomplete combobox', () => {
    renderField();
    const input = screen.getByRole('combobox', { name: '收件人' });
    expect(input.getAttribute('aria-haspopup')).toBe('listbox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocorrect')).toBe('off');
  });

  it('does not open contacts until the user types a query', async () => {
    renderField();
    const input = recipientInput();
    fireEvent.focus(input);
    await act(async () => {});
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('exposes ARIA combobox/listbox state while suggestions are open', async () => {
    renderField();
    const input = recipientInput();
    await openSuggestions(input);
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeDefined();
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
  });

  it('inserts a tab character instead of moving focus', async () => {
    renderField();
    const input = recipientInput();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ada' } });
    input.setSelectionRange(3, 3);
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
    await act(async () => {});
    expect(input.value).toBe('ada\t');
  });

  it('keeps focus in the field when Escape closes the suggestions', async () => {
    renderField();
    const input = recipientInput();
    await openSuggestions(input);
    expect(screen.getByRole('listbox')).toBeDefined();

    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => {});
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(input);
  });

  it('uses ArrowDown and Enter to accept a suggestion', async () => {
    const onChange = vi.fn();
    renderField(onChange);
    const input = recipientInput();
    await openSuggestions(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('ada@example.com'));
  });

  it('does not treat IME Enter as recipient confirmation', async () => {
    const onChange = vi.fn();
    renderField(onChange);
    const input = recipientInput();
    fireEvent.focus(input);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'hanhan' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true });
    fireEvent.compositionEnd(input, { data: '涵涵', target: { value: '涵涵' } });
    await act(async () => {});
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('涵涵');
  });
});
