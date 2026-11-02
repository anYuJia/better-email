import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import CompactDropdown from './CompactDropdown';

const options = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'starred', label: '星标' },
] as const;

function StatefulDropdown({ withIcon = false }: { withIcon?: boolean }) {
  const [value, setValue] = useState<(typeof options)[number]['id']>('all');
  const currentLabel = options.find((option) => option.id === value)?.label ?? '全部';
  return (
    <CompactDropdown
      label="筛选"
      currentLabel={currentLabel}
      ariaLabel={`筛选邮件，当前：${currentLabel}`}
      value={value}
      options={options}
      onChange={setValue}
      triggerIcon={withIcon ? <svg aria-label="筛选图形" /> : undefined}
    />
  );
}

describe('CompactDropdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('exposes a labeled trigger, selected check, and live value', () => {
    render(<StatefulDropdown />);
    const trigger = screen.getByRole('button', { name: '筛选邮件，当前：全部' });
    const details = document.querySelector('details');

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(details?.open).toBe(false);

    fireEvent.click(trigger);
    expect(details?.open).toBe(true);
    expect(screen.getByRole('menuitemradio', { name: '全部' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: '未读' }));

    expect(screen.getByRole('button', { name: '筛选邮件，当前：未读' })).toBeDefined();
    expect(details?.open).toBe(false);
  });

  it('keeps the action and current value accessible when a compact trigger uses an icon', () => {
    render(<StatefulDropdown withIcon />);
    const trigger = screen.getByRole('button', { name: '筛选邮件，当前：全部' });
    expect(trigger.querySelector('.compact-dropdown-trigger-icon')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '未读' }));
    expect(screen.getByRole('button', { name: '筛选邮件，当前：未读' })).toBe(trigger);
    expect(document.querySelector('details')?.open).toBe(false);
  });

  it('supports arrow navigation, Enter selection, and Escape focus return', () => {
    render(<StatefulDropdown />);
    const trigger = screen.getByRole('button', { name: '筛选邮件，当前：全部' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent(document.querySelector('details')!, new Event('toggle'));
    act(() => vi.advanceTimersByTime(50));
    const unread = screen.getByRole('menuitemradio', { name: '未读' });
    expect(document.activeElement).toBe(unread);
    fireEvent.keyDown(unread, { key: 'Enter' });
    expect(screen.getByRole('button', { name: '筛选邮件，当前：未读' })).toBeDefined();

    const updatedTrigger = screen.getByRole('button', { name: '筛选邮件，当前：未读' });
    fireEvent.click(updatedTrigger);
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: '未读' }), { key: 'Escape' });
    expect(document.activeElement).toBe(updatedTrigger);
  });

  it('supports ArrowUp and Space selection while keeping Tab available', () => {
    render(<StatefulDropdown />);
    const trigger = screen.getByRole('button', { name: '筛选邮件，当前：全部' });

    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    fireEvent(document.querySelector('details')!, new Event('toggle'));
    act(() => vi.advanceTimersByTime(50));
    const starred = screen.getByRole('menuitemradio', { name: '星标' });
    expect(document.activeElement).toBe(starred);
    fireEvent.keyDown(starred, { key: ' ' });
    expect(screen.getByRole('button', { name: '筛选邮件，当前：星标' })).toBeDefined();
    expect(document.querySelector('details')?.hasAttribute('open')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '筛选邮件，当前：星标' }));
    const active = screen.getByRole('menuitemradio', { name: '星标' });
    fireEvent.keyDown(active, { key: 'Tab' });
    expect(document.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('does not let queued opening focus steal focus after an immediate outside dismissal', () => {
    render(<><StatefulDropdown /><button>下一个操作</button></>);
    const trigger = screen.getByRole('button', { name: '筛选邮件，当前：全部' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent(document.querySelector('details')!, new Event('toggle'));
    const next = screen.getByRole('button', { name: '下一个操作' });
    fireEvent.pointerDown(next);
    next.focus();
    act(() => vi.advanceTimersByTime(100));
    expect(document.querySelector('details')?.open).toBe(false);
    expect(document.activeElement).toBe(next);
  });

  it('resumes Tab next to the trigger instead of leaving focus in the closed menu', () => {
    render(<><StatefulDropdown /><button>下一个操作</button></>);
    fireEvent.keyDown(screen.getByRole('button', { name: '筛选邮件，当前：全部' }), { key: 'ArrowDown' });
    fireEvent(document.querySelector('details')!, new Event('toggle'));
    act(() => vi.advanceTimersByTime(50));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.querySelector('details')?.open).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '下一个操作' }));
  });
});
