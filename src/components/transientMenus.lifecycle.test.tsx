import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useRef, useState } from 'react';
import ContextMenu from './ContextMenu';
import { useDetailsMenu } from '../hooks/useDetailsMenu';

const animations: {
  element: HTMLElement; frames: Keyframe[];
  cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>;
}[] = [];
const nativeAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('CSS', { supports: () => true });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 20, y: 30, left: 20, top: 30, width: 200, height: 80, right: 220, bottom: 110,
  } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: function (this: HTMLElement, frames: Keyframe[]) {
      const animation = { cancel: vi.fn(), pause: vi.fn(), onfinish: null };
      animations.push({ element: this, frames, cancel: animation.cancel, pause: animation.pause });
      return animation;
    },
  });
});

afterEach(() => {
  cleanup();
  act(() => vi.runOnlyPendingTimers());
  animations.length = 0;
  if (nativeAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', nativeAnimate);
  else delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ContextHarness({ command }: { command: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>打开菜单</button>
    <ContextMenu menu={open ? { x: 20, y: 30, items: [{ id: 'action', label: '立即执行', onSelect: command }], onClose: () => setOpen(false) } : null} />
  </>;
}

function DetailsHarness({ command, visible = true, floating = false }: { command: () => void; visible?: boolean; floating?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { closeMenu } = useDetailsMenu(ref, { floating });
  if (!visible) return null;
  return <details ref={ref}>
    <summary>打开菜单</summary>
    <div data-floating-menu-panel="true">
      <button onClick={() => { command(); closeMenu(); }}>立即执行</button>
    </div>
  </details>;
}

function openDetails() {
  const trigger = screen.getByRole('button', { name: '打开菜单' });
  trigger.focus();
  fireEvent.click(trigger);
  const details = document.querySelector('details')!;
  fireEvent(details, new Event('toggle'));
  return { trigger, details };
}

describe('transient menu integration', () => {
  it('runs a context command and restores focus immediately while only an inert exit remains', () => {
    const command = vi.fn();
    render(<StrictMode><ContextHarness command={command} /></StrictMode>);
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '立即执行' }));

    expect(command).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    const visual = document.querySelector('[data-transient-exit]')!;
    expect(visual.hasAttribute('inert')).toBe(true);
    expect(visual.getAttribute('aria-hidden')).toBe('true');
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);

    fireEvent.click(trigger);
    expect(visual.isConnected).toBe(true);
    expect(visual.hasAttribute('data-transient-exit')).toBe(false);
    expect(screen.getByRole('menuitem', { name: '立即执行' })).toBeDefined();
    act(() => vi.advanceTimersByTime(175));
    expect(screen.getByRole('menu')).toBeDefined();
  });

  it('removes native details open state and runs the command before the exit finishes', () => {
    const command = vi.fn();
    render(<DetailsHarness command={command} />);
    const { trigger, details } = openDetails();
    fireEvent.click(screen.getByRole('button', { name: '立即执行' }));

    expect(command).toHaveBeenCalledTimes(1);
    expect(details.open).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[data-transient-exit]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(170));
    expect(document.querySelector('[data-transient-exit]')).toBeNull();
  });

  it('captures a native summary close before layout hides and cancels its exit on rapid reopen', () => {
    const command = vi.fn();
    render(<DetailsHarness command={command} />);
    const { trigger, details } = openDetails();
    fireEvent.click(trigger);
    expect(details.open).toBe(false);
    const visual = document.querySelector('[data-transient-exit]')!;
    expect(visual).not.toBeNull();

    fireEvent.click(trigger);
    fireEvent(details, new Event('toggle'));
    expect(details.open).toBe(true);
    expect(visual.isConnected).toBe(true);
    expect(visual.hasAttribute('data-transient-exit')).toBe(false);
    act(() => vi.advanceTimersByTime(175));
    expect(details.open).toBe(true);
    expect(command).not.toHaveBeenCalled();
  });

  it('starts a fresh entrance when a conditional toolbar replaces its details node', () => {
    const command = vi.fn();
    const { rerender } = render(<DetailsHarness command={command} />);
    openDetails();
    const firstPanel = document.querySelector('[data-floating-menu-panel]')!;
    expect(firstPanel.getAttribute('data-menu-motion')).toBe('entering');
    rerender(<DetailsHarness command={command} visible={false} />);
    rerender(<DetailsHarness command={command} />);
    openDetails();
    const nextPanel = document.querySelector('[data-floating-menu-panel]')!;
    expect(nextPanel).not.toBe(firstPanel);
    expect(firstPanel.hasAttribute('data-menu-motion')).toBe(false);
    expect(nextPanel.getAttribute('data-menu-motion')).toBe('entering');
  });

  it('pauses a rapid reopen at the trigger event, before the floating position frame', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback); return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const flushFrame = () => act(() => {
      const queued = [...frames.values()]; frames.clear();
      queued.forEach(callback => callback(0));
    });
    render(<DetailsHarness command={vi.fn()} floating />);
    const { trigger, details } = openDetails();
    flushFrame();
    act(() => vi.advanceTimersByTime(250));
    fireEvent.click(trigger);
    const visual = document.querySelector<HTMLElement>('[data-transient-exit]')!;
    visual.style.opacity = '0.32';
    const outgoing = animations[animations.length - 1];
    expect(outgoing.pause).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    // Native toggle and the next positioning frame have not fired yet.
    expect(outgoing.pause).toHaveBeenCalledOnce();
    expect(outgoing.cancel).not.toHaveBeenCalled();
    expect(visual.isConnected).toBe(true);
    fireEvent(details, new Event('toggle'));
    act(() => vi.advanceTimersByTime(32));
    expect(outgoing.pause).toHaveBeenCalledOnce();
    expect(visual.isConnected).toBe(true);
    flushFrame();
    expect(visual.isConnected).toBe(true);
    expect(visual.hasAttribute('data-transient-exit')).toBe(false);
    expect(animations[animations.length - 1].frames[0].opacity).toBe('0.32');
    expect(details.open).toBe(true);
  });
});

describe('context menu target ownership', () => {
  const menuFor = (targetKey: string, x = 20) => ({
    targetKey, x, y: 30, ariaLabel: `${targetKey}邮件操作`, onClose: vi.fn(),
    items: [
      { id: 'open', label: `打开 ${targetKey}`, onSelect: vi.fn() },
      { id: 'move', label: '移动到', children: [{ id: 'move-202', label: '归档', onSelect: vi.fn() }] },
    ],
  });

  it('resets a new target even at the same coordinates and cancels the previous pointerleave timer', () => {
    const { rerender } = render(<ContextMenu menu={menuFor('A')} />);
    const panel = document.querySelector('.context-menu');
    const oldBranch = screen.getByRole('menuitem', { name: '移动到' });
    fireEvent.pointerEnter(oldBranch.parentElement!);
    expect(oldBranch.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerLeave(oldBranch.parentElement!);
    rerender(<ContextMenu menu={null} />);
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    act(() => vi.advanceTimersByTime(50));
    rerender(<ContextMenu menu={menuFor('B')} />);
    const newBranch = screen.getByRole('menuitem', { name: '移动到' });
    expect(document.querySelector('.context-menu')).toBe(panel);
    expect(newBranch).not.toBe(oldBranch);
    expect(newBranch.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '打开 B' }));
    fireEvent.pointerEnter(newBranch.parentElement!);
    act(() => vi.advanceTimersByTime(210));
    expect(newBranch.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the same target subtree when reversing its exit at the same anchor', () => {
    const { rerender } = render(<ContextMenu menu={menuFor('A')} />);
    const panel = document.querySelector('.context-menu');
    const branch = screen.getByRole('menuitem', { name: '移动到' });
    fireEvent.keyDown(branch, { key: 'ArrowRight' });
    expect(branch.getAttribute('aria-expanded')).toBe('true');
    rerender(<ContextMenu menu={null} />);
    act(() => vi.advanceTimersByTime(50));
    rerender(<ContextMenu menu={menuFor('A')} />);
    expect(document.querySelector('.context-menu')).toBe(panel);
    expect(screen.getByRole('menuitem', { name: '移动到' })).toBe(branch);
    expect(branch.getAttribute('aria-expanded')).toBe('true');
    act(() => vi.advanceTimersByTime(260));
    expect(branch.getAttribute('aria-expanded')).toBe('true');
    expect(panel?.hasAttribute('inert')).toBe(false);
  });
});
