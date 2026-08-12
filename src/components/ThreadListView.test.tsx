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
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(30);
    // 行高与虚拟计算常量一致，首行从顶部开始，避免滚动跳动。
    expect(cards[0].style.transform).toBe('translateY(0px)');
    expect(cards[0].style.height).toBe(`${THREAD_ROW_HEIGHT}px`);
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

    fireEvent.click(cards[0]);
    expect(onOpenThread).toHaveBeenCalledWith(threads[0]);
    fireEvent.contextMenu(cards[1], { clientX: 10, clientY: 20 });
    expect(onOpenThreadMenu).toHaveBeenCalledWith(threads[1], 10, 20);
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
