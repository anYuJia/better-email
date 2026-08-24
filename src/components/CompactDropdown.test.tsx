import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import CompactDropdown from './CompactDropdown';

const options = [
  { id: 'all', label: '全部' },
  { id: 'unread', label: '未读' },
  { id: 'starred', label: '星标' },
] as const;

function StatefulDropdown() {
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
    />
  );
}

describe('CompactDropdown', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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

  it('supports arrow navigation, Enter selection, and Escape focus return', () => {
    render(<StatefulDropdown />);
    const trigger = screen.getByRole('button', { name: '筛选邮件，当前：全部' });

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const unread = screen.getByRole('menuitemradio', { name: '未读' });
    expect(document.activeElement).toBe(unread);
    fireEvent.keyDown(unread, { key: 'Enter' });
    expect(screen.getByRole('button', { name: '筛选邮件，当前：未读' })).toBeDefined();

    const updatedTrigger = screen.getByRole('button', { name: '筛选邮件，当前：未读' });
    fireEvent.click(updatedTrigger);
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: '未读' }), { key: 'Escape' });
    expect(document.activeElement).toBe(updatedTrigger);
  });
});
