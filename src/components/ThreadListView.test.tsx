import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ThreadSummary } from '../app/types';
import ThreadListView, { THREAD_ROW_HEIGHT } from './ThreadListView';

afterEach(cleanup);

function thread(index: number): ThreadSummary {
  return {
    thread_key: `thread-${index}`,
    subject: `Subject ${index}`,
    message_count: index + 1,
    unread_count: index % 3 === 0 ? 2 : 0,
    latest_at: '2026-08-09T08:00:00.000Z',
    participants: `a${index}@example.com`,
    is_muted: false,
  };
}

describe('ThreadListView 虚拟化', () => {
  it('大量会话时只渲染可视区及 overscan，而不是完整数组', () => {
    const threads = Array.from({ length: 300 }, (_, index) => thread(index));
    const { container } = render(
      <ThreadListView
        threads={threads}
        activeThread={null}
        onOpenThread={vi.fn()}
        onOpenThreadMenu={vi.fn()}
      />,
    );

    const cards = container.querySelectorAll<HTMLElement>('.thread-card');
    const rows = container.querySelectorAll<HTMLElement>('.thread-list-item');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(30);
    // 虚拟位移属于非交互的 listitem。按钮本身受全局
    // `transform: none !important` 约束，不能承担功能性布局位移。
    expect(rows[0].style.transform).toBe('translateY(0px)');
    expect(rows[1].style.transform).toBe(`translateY(${THREAD_ROW_HEIGHT}px)`);
    expect(rows[0].style.height).toBe(`${THREAD_ROW_HEIGHT}px`);
    expect(cards[0].style.transform).toBe('');
    expect(cards[0].style.position).toBe('');
    // 外层包裹高度 = 全部会话行高之和。
    const wrapper = container.querySelector('.thread-list-viewport-wrapper') as HTMLElement;
    expect(wrapper.style.height).toBe(`${THREAD_ROW_HEIGHT * threads.length}px`);
  });

  it('保留点击打开、右键菜单、未读与选中状态', () => {
    const onOpenThread = vi.fn();
    const onOpenThreadMenu = vi.fn();
    const threads = [thread(0), thread(1)];
    const { container } = render(
      <ThreadListView
        threads={threads}
        activeThread={threads[0]}
        onOpenThread={onOpenThread}
        onOpenThreadMenu={onOpenThreadMenu}
      />,
    );

    const cards = container.querySelectorAll<HTMLElement>('.thread-card');
    expect(cards.length).toBe(2);

    expect(cards[0].className).toContain('selected');
    expect(cards[0].className).toContain('is-unread');
    expect(cards[1].className).toContain('is-read');
    const items = container.querySelectorAll('[role="listitem"]');
    expect(container.querySelector('[role="list"]')?.getAttribute('aria-label')).toBe('会话列表');
    expect(items[0].getAttribute('aria-current')).toBe('true');
    expect(items[0].getAttribute('aria-posinset')).toBe('1');
    expect(items[0].getAttribute('aria-setsize')).toBe('2');

    fireEvent.click(cards[0]);
    expect(onOpenThread).toHaveBeenCalledWith(threads[0]);
    fireEvent.contextMenu(cards[1], { clientX: 10, clientY: 20 });
    expect(onOpenThreadMenu).toHaveBeenCalledWith(threads[1], 10, 20);

    vi.spyOn(cards[0], 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      width: 320,
      height: 72,
      right: 420,
      bottom: 272,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    fireEvent.keyDown(cards[0], { key: 'F10', shiftKey: true });
    expect(onOpenThreadMenu).toHaveBeenLastCalledWith(threads[0], 260, 236);
  });

  it('空态保留', () => {
    const { container } = render(
      <ThreadListView
        threads={[]}
        activeThread={null}
        onOpenThread={vi.fn()}
        onOpenThreadMenu={vi.fn()}
      />,
    );
    expect(container.querySelector('.empty-state')?.textContent).toContain('没有会话');
  });
});
