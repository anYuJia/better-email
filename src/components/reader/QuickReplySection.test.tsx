import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Message } from '../../app/types';
import QuickReplySection from './QuickReplySection';

const selected = {
  id: 7,
  account_id: 1,
  sender_name: 'Ada',
  sender_email: 'ada@example.com',
} as Message;

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});

function mobileViewport() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 720px)',
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

function mobileReveal(reduce = false) {
  vi.useFakeTimers();
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const preference = {
    matches: reduce,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
  };
  vi.stubGlobal('matchMedia', (query: string) => query === '(prefers-reduced-motion: reduce)' ? preference : {
    matches: query === '(max-width: 720px)', addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, 360, this.classList.contains('is-collapsed') ? 48 : 180);
  });
  const animations: {
    element: HTMLElement;
    frames: Keyframe[];
    timing: KeyframeAnimationOptions;
    cancel: ReturnType<typeof vi.fn>;
    onfinish: (() => void) | null;
  }[] = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(function (this: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) {
      const animation = { element: this, frames, timing, cancel: vi.fn(), onfinish: null };
      animations.push(animation);
      return animation;
    }),
  });
  return { animations, listeners };
}

const emptyReplyProps = {
  selected, quickReplyBody: '', onQuickReplyChange: vi.fn(),
  onComposeFromMessage: vi.fn(), onSendQuickReply: vi.fn(),
};

describe('QuickReplySection mobile reveal', () => {
  it('reveals only the reply surface while accepting input immediately without restarting on typing', () => {
    const { animations } = mobileReveal();
    const change = vi.fn();
    const view = render(<QuickReplySection {...emptyReplyProps} onQuickReplyChange={change} />);
    fireEvent.click(screen.getByRole('button', { name: '开始快速回复' }));
    const editor = screen.getByRole('textbox');
    const section = editor.closest('section')!;
    expect(document.activeElement).toBe(editor);
    expect(animations).toHaveLength(1);
    expect(animations[0].element).toBe(section);
    expect(animations[0].frames).toEqual([
      { clipPath: 'inset(0px 0px 132px 0px)' }, { clipPath: 'inset(0px 0px 0px 0px)' },
    ]);
    expect(animations[0].timing.duration).toBe(180);
    expect(section.hasAttribute('data-reply-revealing')).toBe(true);

    fireEvent.change(editor, { target: { value: '立即输入' } });
    expect(change).toHaveBeenCalledWith('立即输入');
    view.rerender(<QuickReplySection {...emptyReplyProps} quickReplyBody="立即输入" onQuickReplyChange={change} />);
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(document.activeElement).toBe(editor);
    expect(animations).toHaveLength(1);
    animations[0].onfinish?.();
    expect(section.hasAttribute('data-reply-revealing')).toBe(false);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
  });

  it('does not replay an entry animation for a restored draft', () => {
    const { animations } = mobileReveal();
    render(<QuickReplySection {...emptyReplyProps} quickReplyBody="已有草稿" />);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(animations).toHaveLength(0);
  });

  it('skips reduced motion while still opening and focusing the editor immediately', () => {
    const { animations } = mobileReveal(true);
    render(<QuickReplySection {...emptyReplyProps} />);
    fireEvent.click(screen.getByRole('button', { name: '开始快速回复' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect(animations).toHaveLength(0);
  });

  it('settles in place when reduced motion changes and cleans up the listener', () => {
    const { animations, listeners } = mobileReveal();
    render(<QuickReplySection {...emptyReplyProps} />);
    fireEvent.click(screen.getByRole('button', { name: '开始快速回复' }));
    const editor = screen.getByRole('textbox');
    for (const listener of [...listeners]) listener({ matches: true } as MediaQueryListEvent);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    expect(editor.closest('section')!.hasAttribute('data-reply-revealing')).toBe(false);
    expect(document.activeElement).toBe(editor);
  });

  it('cancels the old reveal on message navigation without expanding the next empty reply', () => {
    const { animations, listeners } = mobileReveal();
    const view = render(<QuickReplySection {...emptyReplyProps} />);
    fireEvent.click(screen.getByRole('button', { name: '开始快速回复' }));
    view.rerender(<QuickReplySection {...emptyReplyProps} selected={{ ...selected, id: 8 }} />);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(animations[0].onfinish).toBeNull();
    expect(listeners.size).toBe(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: '开始快速回复' })).toBeTruthy();
    vi.advanceTimersByTime(500);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
  });
});

describe('QuickReplySection focus and draft handoff', () => {
  it('uses a mobile entry for an empty reply and keeps the editor open after activating it', () => {
    mobileViewport();
    const onComposeFromMessage = vi.fn();
    render(<QuickReplySection selected={selected} quickReplyBody="" onQuickReplyChange={vi.fn()} onComposeFromMessage={onComposeFromMessage} onSendQuickReply={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '开始快速回复' }));
    const editor = screen.getByRole('textbox');
    expect(document.activeElement).toBe(editor);
    fireEvent.blur(editor);
    expect(screen.getByRole('textbox')).toBe(editor);
    fireEvent.click(screen.getByRole('button', { name: '展开回复' }));
    expect(onComposeFromMessage).toHaveBeenCalledWith(selected, 'reply', '');
  });

  it('restores mobile drafts without expanding an empty reply for another account or message', () => {
    mobileViewport();
    const input = { selected, quickReplyBody: '已有草稿', onQuickReplyChange: vi.fn(), onComposeFromMessage: vi.fn(), onSendQuickReply: vi.fn() };
    const view = render(<QuickReplySection {...input} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('已有草稿');
    fireEvent.focus(screen.getByRole('textbox'));
    view.rerender(<QuickReplySection {...input} quickReplyBody="" />);
    expect(screen.getByRole('textbox')).toBeDefined();
    view.rerender(<QuickReplySection {...input} selected={{ ...selected, id: 8 }} quickReplyBody="" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '开始快速回复' }));
    view.rerender(<QuickReplySection {...input} selected={{ ...selected, id: 8, account_id: 2 }} quickReplyBody="" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    view.rerender(<QuickReplySection {...input} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('已有草稿');
  });

  it('keeps an empty failed or submitting mobile reply visible', () => {
    mobileViewport();
    const input = { selected, quickReplyBody: '', onQuickReplyChange: vi.fn(), onComposeFromMessage: vi.fn(), onSendQuickReply: vi.fn() };
    const view = render(<QuickReplySection {...input} saveError="清空后的草稿未保存，请重试" />);
    expect(screen.getByRole('textbox')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toContain('未保存');
    view.rerender(<QuickReplySection {...input} submissionPending />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: '开始快速回复' })).toBeNull();
  });

  it('starts collapsed on desktop and keeps the explicitly opened editor stable after blur', () => {
    const { container } = render(
      <QuickReplySection
        selected={selected}
        quickReplyBody=""
        onQuickReplyChange={vi.fn()}
        onComposeFromMessage={vi.fn()}
        onSendQuickReply={vi.fn()}
      />,
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '开始快速回复' }));
    const editor = screen.getByRole('textbox', { name: '输入回复' });
    fireEvent.focus(editor);
    fireEvent.blur(editor);
    expect(container.querySelector('.is-collapsed')).toBeNull();
    expect(screen.getByRole('button', { name: '展开回复' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull();
  });

  it('protects a reply during submission and exposes failed persistence with retry', () => {
    const retry = vi.fn();
    render(<QuickReplySection selected={selected} quickReplyBody="保留内容" onQuickReplyChange={vi.fn()} onComposeFromMessage={vi.fn()} onSendQuickReply={vi.fn()} submissionPending saveError="本地保存失败，内容仍在此处。" onRetrySave={retry} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);
    expect((screen.getByRole('button', { name: '发送回复' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('本地保存失败');
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('passes the current reply into the full composer without clearing the background draft', () => {
    const onComposeFromMessage = vi.fn();
    const onQuickReplyChange = vi.fn();
    render(
      <QuickReplySection
        selected={selected}
        quickReplyBody="转到写信窗口"
        onQuickReplyChange={onQuickReplyChange}
        onComposeFromMessage={onComposeFromMessage}
        onSendQuickReply={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '展开回复' }));

    expect(onComposeFromMessage).toHaveBeenCalledWith(selected, 'reply', '转到写信窗口');
    expect(onQuickReplyChange).not.toHaveBeenCalled();
  });

  it('returns focus to the editor before a successful send disables the action', () => {
    const onSendQuickReply = vi.fn();
    render(
      <QuickReplySection
        selected={selected}
        quickReplyBody="准备发送"
        onQuickReplyChange={vi.fn()}
        onComposeFromMessage={vi.fn()}
        onSendQuickReply={onSendQuickReply}
      />,
    );

    const send = screen.getByRole('button', { name: '发送回复' });
    send.focus();
    fireEvent.click(send);

    expect(onSendQuickReply).toHaveBeenCalledWith(selected);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '输入回复' }));
  });
  it('continues the active full composer without showing a second inline editor', () => {
    const onComposeFromMessage = vi.fn();
    const input = { selected, quickReplyBody: '安全保留的原稿', onQuickReplyChange: vi.fn(), onComposeFromMessage, onSendQuickReply: vi.fn() };
    const view = render(<QuickReplySection {...input} continuingInComposer saveError="恢复点尚未保存" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '继续在写信窗口编辑' }));
    expect(onComposeFromMessage).toHaveBeenCalledWith(selected, 'reply');
    expect(screen.getByRole('alert').textContent).toContain('恢复点尚未保存');
    view.rerender(<QuickReplySection {...input} />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('安全保留的原稿');
  });

});
