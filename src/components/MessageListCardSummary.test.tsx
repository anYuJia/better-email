import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MessageSummary } from '../app/types';
import MessageListCard from './MessageListCard';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 邮件列表正文摘要必须固定为一行：渲染真实长正文，加载实际生效的 CSS
 * 级联（合并后的 message-list.css 已收纳 2026 系列的摘要排版规则），
 * 断言计算样式、title 无障碍文本，
 * 且渲染结果始终只有一行高度（line-height 唯一来源）。
 */
const cssCascade = [
  'styles/message-list.css',
].map((file) => readFileSync(join(root, file), 'utf8'));

const longBody = '这是一封包含超长正文摘要的测试邮件，'.repeat(80);

function messageWithLongPreview(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: 1,
    account_id: 1,
    account_email: 'a@example.com',
    folder_id: 1,
    folder_role: 'inbox',
    sender_name: 'Alice',
    sender_email: 'alice@example.com',
    recipients: 'me@example.com',
    cc: '',
    bcc: '',
    subject: '长摘要测试邮件',
    snippet: longBody,
    security_warnings: [],
    received_at: '2026-08-10T10:00:00+08:00',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: 6001,
    ...overrides,
  };
}

function renderCard(
  message: MessageSummary,
  options: {
    isSelected?: boolean;
    isSelectionMode?: boolean;
    appShell?: boolean;
    onToggleMessageSelection?: (messageId: number, checked: boolean) => void;
  } = {},
) {
  return render(
    <div className={options.appShell ? 'app-shell' : undefined} style={{ width: 340 }}>
      <MessageListCard
        message={message}
        isCurrentMessage={false}
        isSelected={options.isSelected ?? false}
        isDragging={false}
        isNew={false}
        isSelectionMode={options.isSelectionMode ?? false}
        hasBulkSelection={false}
        selectedMessageIdsRef={{ current: [] }}
        onSelectMessage={() => undefined}
        onToggleMessageSelection={options.onToggleMessageSelection ?? (() => undefined)}
        onToggleAllVisible={() => undefined}
        onOpenMessageMenu={() => undefined}
        onCloseMessageMenu={() => undefined}
        onSetDraggingMessageIds={() => undefined}
      />
    </div>,
  );
}

describe('message list summary single-line rendering', () => {
  afterEach(() => {
    cleanup();
    document.head.querySelectorAll('style[data-summary-test]').forEach((node) => node.remove());
  });

  function injectCascade() {
    for (const css of cssCascade) {
      const style = document.createElement('style');
      style.setAttribute('data-summary-test', 'true');
      style.textContent = css;
      document.head.appendChild(style);
    }
  }

  it('renders a long body preview on exactly one line with ellipsis and full title', () => {
    injectCascade();
    renderCard(messageWithLongPreview());

    expect(document.querySelector('.message-card')?.getAttribute('data-message-id')).toBe('1');
    expect(document.querySelector('.message-card')?.getAttribute('data-folder-role')).toBe('inbox');
    const preview = document.querySelector<HTMLParagraphElement>('.message-card p');
    expect(preview).not.toBeNull();

    // 完整摘要仍保留在 DOM（title 无障碍文本 = 完整内容）。
    expect(preview!.textContent).toBe(longBody);
    expect(preview!.getAttribute('title')).toBe(longBody);

    // 实际生效的计算样式：单行 + 隐藏溢出 + 省略号。
    const computed = window.getComputedStyle(preview!);
    expect(computed.whiteSpace).toBe('nowrap');
    expect(computed.overflow).toBe('hidden');
    expect(computed.textOverflow).toBe('ellipsis');

    // 行高由 CSS 固定：整段预览只有一行高，不会撑高列表行。
    const lineHeightPx = Number.parseFloat(computed.lineHeight);
    expect(lineHeightPx).toBeGreaterThan(0);
    expect(preview!.style.height).toBe('');
    expect(preview!.className).not.toContain('expanded');
  });

  it('keeps subject and preview on separate single lines without wrapping', () => {
    injectCascade();
    renderCard(messageWithLongPreview({
      id: 2,
      subject: `超长主题${'的主题'.repeat(60)}`,
      snippet: '',
    }));

    const subject = document.querySelector<HTMLElement>('.message-card .subject');
    const preview = document.querySelector<HTMLParagraphElement>('.message-card p');
    expect(subject).not.toBeNull();
    const subjectStyle = window.getComputedStyle(subject!);
    expect(subjectStyle.whiteSpace).toBe('nowrap');
    expect(subjectStyle.textOverflow).toBe('ellipsis');

    // 无正文时摘要不渲染（不出现占位空行）。
    expect(preview).toBeNull();
  });

  it('keeps the row hierarchy free of repeated sender or subject metadata', () => {
    const { container } = renderCard(messageWithLongPreview({
      sender_name: 'Gitee',
      subject: '项目通知',
      snippet: '',
      labels: ['Gitee', '项目通知', '团队'],
    }));

    expect(container.querySelector('.message-card .sender')?.textContent).toBe('Gitee');
    expect(container.querySelector('.message-card .subject')?.textContent).toBe('项目通知');
    expect(container.querySelector('.message-card .message-chips')?.textContent).toBe('团队');
    expect(container.querySelector('.message-card .message-chips')?.textContent).not.toContain('Gitee');
    expect(container.querySelector('.message-card .message-chips')?.textContent).not.toContain('项目通知');
  });

  it('reveals a circular upper-left checkbox in selection mode without shifting row content', () => {
    const onToggleMessageSelection = vi.fn();
    injectCascade();
    const { container } = renderCard(messageWithLongPreview(), {
      isSelectionMode: true,
      isSelected: true,
      appShell: true,
      onToggleMessageSelection,
    });
    const card = container.querySelector('.message-card')!;
    const selection = container.querySelector<HTMLElement>('.message-select')!;
    const checkbox = container.querySelector<HTMLInputElement>('.message-select input')!;
    const main = container.querySelector<HTMLButtonElement>('.message-card-main')!;

    expect(card.classList.contains('is-selection-mode')).toBe(true);
    expect(card.classList.contains('is-selected')).toBe(true);
    expect(checkbox.tabIndex).toBe(0);
    expect(checkbox.checked).toBe(true);
    expect(getComputedStyle(selection).left).toBe('0px');
    expect(getComputedStyle(selection).top).toBe('0px');
    expect(getComputedStyle(selection).width).toBe('40px');
    expect(getComputedStyle(selection).height).toBe('40px');
    expect(getComputedStyle(checkbox).borderRadius).toBe('50%');
    fireEvent.click(checkbox);
    expect(onToggleMessageSelection).toHaveBeenCalledWith(1, false);

    fireEvent.keyDown(main, { key: ' ' });
    expect(onToggleMessageSelection).toHaveBeenCalledWith(1, false);
  });
});
