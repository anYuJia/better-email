import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CompactDropdown from './CompactDropdown';
import MessageDateRangePicker from './MessageDateRangePicker';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('Keyboard Containment in Overlays and Menus', () => {
  it('prevents default on arrow navigation inside CompactDropdown so global shortcuts are not triggered', () => {
    const onChange = vi.fn();
    const options = [
      { id: 'all' as const, label: '全部' },
      { id: 'unread' as const, label: '未读' },
    ];

    render(
      <CompactDropdown
        label="邮件筛选"
        ariaLabel="邮件筛选"
        currentLabel="全部"
        value="all"
        options={options}
        onChange={onChange}
      />
    );

    const trigger = screen.getByRole('button', { name: '邮件筛选' });
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    trigger.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('stops arrow keys propagation when navigating year and month selectors in MessageDateRangePicker', () => {
    const onConfirm = vi.fn();
    render(
      <MessageDateRangePicker
        onConfirm={onConfirm}
      />
    );

    const trigger = screen.getByRole('button', { name: '按日期范围筛选邮件' });
    fireEvent.click(trigger);

    const monthButton = screen.getByRole('combobox', { name: '开始月份' });
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    monthButton.dispatchEvent(event);
    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
