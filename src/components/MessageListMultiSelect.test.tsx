import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MessageSummary } from '../app/types';
import MessageListCard from './MessageListCard';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const cssCascade = [
  'styles/message-list.css',
  'styles/mobile.css',
].map((file) => readFileSync(join(root, file), 'utf8'));

function createSampleMessage(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: 101,
    account_id: 1,
    account_email: 'user@example.com',
    folder_id: 1,
    folder_role: 'inbox',
    sender_name: 'Test Sender',
    sender_email: 'sender@example.com',
    recipients: 'user@example.com',
    cc: '',
    bcc: '',
    subject: 'Multi-selection test subject',
    snippet: 'This is a test preview for verifying multi-selection mode.',
    security_warnings: [],
    received_at: '2026-08-10T10:00:00+08:00',
    is_read: true,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: 7001,
    ...overrides,
  };
}

describe('MessageListCard desktop vs mobile multi-select behavior', () => {
  afterEach(() => {
    cleanup();
    document.head.querySelectorAll('style[data-multiselect-test]').forEach((node) => node.remove());
  });

  function injectStyles() {
    for (const css of cssCascade) {
      const style = document.createElement('style');
      style.setAttribute('data-multiselect-test', 'true');
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  describe('Desktop behavior (Avatar / Checkbox Swap)', () => {
    it('shows avatar and hides checkbox by default when unselected', () => {
      injectStyles();
      const message = createSampleMessage();
      const { container } = render(
        <div className="app-shell" style={{ width: 400 }}>
          <MessageListCard
            mobile={false}
            message={message}
            isCurrentMessage={false}
            isSelected={false}
            isDragging={false}
            isNew={false}
            isSelectionMode={false}
            hasBulkSelection={false}
            selectedMessageIdsRef={{ current: [] }}
            onSelectMessage={() => undefined}
            onToggleMessageSelection={() => undefined}
            onToggleAllVisible={() => undefined}
            onOpenMessageMenu={() => undefined}
            onCloseMessageMenu={() => undefined}
            onSetDraggingMessageIds={() => undefined}
          />
        </div>,
      );

      const leading = container.querySelector<HTMLElement>('.message-leading')!;
      const select = container.querySelector<HTMLElement>('.message-select')!;
      expect(getComputedStyle(leading).opacity).toBe('1');
      expect(getComputedStyle(select).opacity).toBe('0');
    });

    it('hides avatar and reveals checkbox when message is selected', () => {
      injectStyles();
      const message = createSampleMessage();
      const { container } = render(
        <div className="app-shell" style={{ width: 400 }}>
          <MessageListCard
            mobile={false}
            message={message}
            isCurrentMessage={false}
            isSelected={true}
            isDragging={false}
            isNew={false}
            isSelectionMode={true}
            hasBulkSelection={false}
            selectedMessageIdsRef={{ current: [101] }}
            onSelectMessage={() => undefined}
            onToggleMessageSelection={() => undefined}
            onToggleAllVisible={() => undefined}
            onOpenMessageMenu={() => undefined}
            onCloseMessageMenu={() => undefined}
            onSetDraggingMessageIds={() => undefined}
          />
        </div>,
      );

      const leading = container.querySelector<HTMLElement>('.message-leading')!;
      const select = container.querySelector<HTMLElement>('.message-select')!;
      const checkbox = container.querySelector<HTMLInputElement>('.message-select input')!;
      expect(getComputedStyle(leading).opacity).toBe('0');
      expect(getComputedStyle(select).opacity).toBe('1');
      expect(checkbox.checked).toBe(true);
    });

    it('desktop unselected cards in bulk mode retain avatar display (swap on hover/select)', () => {
      injectStyles();
      const message = createSampleMessage();
      const { container } = render(
        <div className="app-shell" style={{ width: 400 }}>
          <MessageListCard
            mobile={false}
            message={message}
            isCurrentMessage={false}
            isSelected={false}
            isDragging={false}
            isNew={false}
            isSelectionMode={true}
            hasBulkSelection={true}
            selectedMessageIdsRef={{ current: [999] }}
            onSelectMessage={() => undefined}
            onToggleMessageSelection={() => undefined}
            onToggleAllVisible={() => undefined}
            onOpenMessageMenu={() => undefined}
            onCloseMessageMenu={() => undefined}
            onSetDraggingMessageIds={() => undefined}
          />
        </div>,
      );

      const leading = container.querySelector<HTMLElement>('.message-leading')!;
      const select = container.querySelector<HTMLElement>('.message-select')!;
      // On desktop, unselected card in selection mode shows avatar until hovered/selected
      expect(getComputedStyle(leading).opacity).toBe('1');
      expect(getComputedStyle(select).opacity).toBe('0');
    });
  });

  describe('Mobile multi-selection mode', () => {
    it('normal mode shows avatar, hides checkbox, and tapping card opens message', () => {
      injectStyles();
      const onSelectMessage = vi.fn();
      const onToggleMessageSelection = vi.fn();
      const message = createSampleMessage();

      const { container } = render(
        <div className="app-shell is-mobile-app">
          <div className="mobile-app-surface mobile-screen-inbox">
            <MessageListCard
              mobile={true}
              message={message}
              isCurrentMessage={false}
              isSelected={false}
              isDragging={false}
              isNew={false}
              isSelectionMode={false}
              hasBulkSelection={false}
              selectedMessageIdsRef={{ current: [] }}
              onSelectMessage={onSelectMessage}
              onToggleMessageSelection={onToggleMessageSelection}
              onToggleAllVisible={() => undefined}
              onOpenMessageMenu={() => undefined}
              onCloseMessageMenu={() => undefined}
              onSetDraggingMessageIds={() => undefined}
            />
          </div>
        </div>,
      );

      const leading = container.querySelector<HTMLElement>('.message-leading')!;
      const select = container.querySelector<HTMLElement>('.message-select')!;
      expect(getComputedStyle(leading).opacity).toBe('1');
      expect(getComputedStyle(select).opacity).toBe('0');

      // Tapping card opens the message
      const card = container.querySelector<HTMLElement>('.message-card')!;
      fireEvent.click(card);
      expect(onSelectMessage).toHaveBeenCalledWith(101);
      expect(onToggleMessageSelection).not.toHaveBeenCalled();
    });

    it('selection mode reveals checkboxes for ALL cards (both selected and unselected)', () => {
      injectStyles();
      const onSelectMessage = vi.fn();
      const onToggleMessageSelection = vi.fn();
      const message1 = createSampleMessage({ id: 101, subject: 'First' });
      const message2 = createSampleMessage({ id: 102, subject: 'Second' });

      const { container } = render(
        <div className="app-shell is-mobile-app">
          <div className="mobile-app-surface mobile-screen-inbox">
            {/* message1 is selected */}
            <MessageListCard
              mobile={true}
              message={message1}
              isCurrentMessage={false}
              isSelected={true}
              isDragging={false}
              isNew={false}
              isSelectionMode={true}
              hasBulkSelection={false}
              selectedMessageIdsRef={{ current: [101] }}
              onSelectMessage={onSelectMessage}
              onToggleMessageSelection={onToggleMessageSelection}
              onToggleAllVisible={() => undefined}
              onOpenMessageMenu={() => undefined}
              onCloseMessageMenu={() => undefined}
              onSetDraggingMessageIds={() => undefined}
            />
            {/* message2 is unselected */}
            <MessageListCard
              mobile={true}
              message={message2}
              isCurrentMessage={false}
              isSelected={false}
              isDragging={false}
              isNew={false}
              isSelectionMode={true}
              hasBulkSelection={false}
              selectedMessageIdsRef={{ current: [101] }}
              onSelectMessage={onSelectMessage}
              onToggleMessageSelection={onToggleMessageSelection}
              onToggleAllVisible={() => undefined}
              onOpenMessageMenu={() => undefined}
              onCloseMessageMenu={() => undefined}
              onSetDraggingMessageIds={() => undefined}
            />
          </div>
        </div>,
      );

      const cards = container.querySelectorAll('.message-card');
      expect(cards.length).toBe(2);

      // Card 1 (selected):
      const leading1 = cards[0].querySelector<HTMLElement>('.message-leading')!;
      const select1 = cards[0].querySelector<HTMLElement>('.message-select')!;
      const checkbox1 = cards[0].querySelector<HTMLInputElement>('.message-select input')!;
      expect(getComputedStyle(leading1).opacity).toBe('0');
      expect(getComputedStyle(select1).opacity).toBe('1');
      expect(checkbox1.checked).toBe(true);

      // Card 2 (UNSELECTED):
      const leading2 = cards[1].querySelector<HTMLElement>('.message-leading')!;
      const select2 = cards[1].querySelector<HTMLElement>('.message-select')!;
      const checkbox2 = cards[1].querySelector<HTMLInputElement>('.message-select input')!;
      // Unselected card MUST also show checkbox and hide avatar in mobile selection mode
      expect(getComputedStyle(leading2).opacity).toBe('0');
      expect(getComputedStyle(select2).opacity).toBe('1');
      expect(checkbox2.checked).toBe(false);

      // Touch target dimensions: at least 44x44px for easy mobile touch
      expect(Number.parseInt(getComputedStyle(select2).width, 10)).toBeGreaterThanOrEqual(44);
      expect(Number.parseInt(getComputedStyle(select2).height, 10)).toBeGreaterThanOrEqual(44);
    });

    it('clicking checkbox toggles selection without opening the reader', () => {
      injectStyles();
      const onSelectMessage = vi.fn();
      const onToggleMessageSelection = vi.fn();
      const message = createSampleMessage({ id: 102 });

      const { container } = render(
        <div className="app-shell is-mobile-app">
          <div className="mobile-app-surface mobile-screen-inbox">
            <MessageListCard
              mobile={true}
              message={message}
              isCurrentMessage={false}
              isSelected={false}
              isDragging={false}
              isNew={false}
              isSelectionMode={true}
              hasBulkSelection={false}
              selectedMessageIdsRef={{ current: [101] }}
              onSelectMessage={onSelectMessage}
              onToggleMessageSelection={onToggleMessageSelection}
              onToggleAllVisible={() => undefined}
              onOpenMessageMenu={() => undefined}
              onCloseMessageMenu={() => undefined}
              onSetDraggingMessageIds={() => undefined}
            />
          </div>
        </div>,
      );

      const checkbox = container.querySelector<HTMLInputElement>('.message-select input')!;
      fireEvent.click(checkbox);

      expect(onToggleMessageSelection).toHaveBeenCalledWith(102, true);
      expect(onSelectMessage).not.toHaveBeenCalled();
    });

    it('tapping row in mobile selection mode toggles selection without opening the reader', () => {
      injectStyles();
      const onSelectMessage = vi.fn();
      const onToggleMessageSelection = vi.fn();
      const message = createSampleMessage({ id: 102 });

      const { container } = render(
        <div className="app-shell is-mobile-app">
          <div className="mobile-app-surface mobile-screen-inbox">
            <MessageListCard
              mobile={true}
              message={message}
              isCurrentMessage={false}
              isSelected={false}
              isDragging={false}
              isNew={false}
              isSelectionMode={true}
              hasBulkSelection={false}
              selectedMessageIdsRef={{ current: [101] }}
              onSelectMessage={onSelectMessage}
              onToggleMessageSelection={onToggleMessageSelection}
              onToggleAllVisible={() => undefined}
              onOpenMessageMenu={() => undefined}
              onCloseMessageMenu={() => undefined}
              onSetDraggingMessageIds={() => undefined}
            />
          </div>
        </div>,
      );

      const card = container.querySelector<HTMLElement>('.message-card')!;
      fireEvent.click(card);

      expect(onToggleMessageSelection).toHaveBeenCalledWith(102, true);
      expect(onSelectMessage).not.toHaveBeenCalled();
    });

    it('exiting selection mode immediately restores avatars and hides checkboxes', () => {
      injectStyles();
      const onSelectMessage = vi.fn();
      const onToggleMessageSelection = vi.fn();
      const message = createSampleMessage({ id: 102 });

      const { container, rerender } = render(
        <div className="app-shell is-mobile-app">
          <div className="mobile-app-surface mobile-screen-inbox">
            <MessageListCard
              mobile={true}
              message={message}
              isCurrentMessage={false}
              isSelected={false}
              isDragging={false}
              isNew={false}
              isSelectionMode={true}
              hasBulkSelection={false}
              selectedMessageIdsRef={{ current: [101] }}
              onSelectMessage={onSelectMessage}
              onToggleMessageSelection={onToggleMessageSelection}
              onToggleAllVisible={() => undefined}
              onOpenMessageMenu={() => undefined}
              onCloseMessageMenu={() => undefined}
              onSetDraggingMessageIds={() => undefined}
            />
          </div>
        </div>,
      );

      expect(getComputedStyle(container.querySelector('.message-leading')!).opacity).toBe('0');
      expect(getComputedStyle(container.querySelector('.message-select')!).opacity).toBe('1');

      // Exit selection mode
      rerender(
        <div className="app-shell is-mobile-app">
          <div className="mobile-app-surface mobile-screen-inbox">
            <MessageListCard
              mobile={true}
              message={message}
              isCurrentMessage={false}
              isSelected={false}
              isDragging={false}
              isNew={false}
              isSelectionMode={false}
              hasBulkSelection={false}
              selectedMessageIdsRef={{ current: [] }}
              onSelectMessage={onSelectMessage}
              onToggleMessageSelection={onToggleMessageSelection}
              onToggleAllVisible={() => undefined}
              onOpenMessageMenu={() => undefined}
              onCloseMessageMenu={() => undefined}
              onSetDraggingMessageIds={() => undefined}
            />
          </div>
        </div>,
      );

      expect(getComputedStyle(container.querySelector('.message-leading')!).opacity).toBe('1');
      expect(getComputedStyle(container.querySelector('.message-select')!).opacity).toBe('0');
    });
  });
});
