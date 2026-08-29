import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import MessageDateRangePicker from './MessageDateRangePicker';

describe('MessageDateRangePicker', () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  it('portals the modal outside the list container and closes from the backdrop', () => {
    render(
      <div data-testid="list-container">
        <MessageDateRangePicker onConfirm={vi.fn()} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: '按日期范围筛选邮件' }));
    const backdrop = document.querySelector('.message-date-range-backdrop');
    expect(backdrop?.parentElement).toBe(document.body);
    expect(backdrop?.closest('[data-testid="list-container"]')).toBeNull();
    expect(screen.getByRole('dialog', { name: '按日期范围筛选邮件' })).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.mouseDown(backdrop!, { target: backdrop });
    expect(screen.queryByRole('dialog', { name: '按日期范围筛选邮件' })).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps independent start and end calendars available in the modal', () => {
    render(<MessageDateRangePicker onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '按日期范围筛选邮件' }));

    expect(screen.getByRole('button', { name: '开始上一个月' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '结束下一个月' })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: '开始年份' })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: '结束年份' })).not.toBeNull();
    const calendars = document.querySelectorAll('.message-date-range-calendar');
    expect(calendars.length).toBe(2);
    expect(within(calendars[0] as HTMLElement).getAllByRole('button', { name: /开始\d{4}-\d{2}-\d{2}/ }).length).toBeGreaterThan(0);
    expect(within(calendars[1] as HTMLElement).getAllByRole('button', { name: /结束\d{4}-\d{2}-\d{2}/ }).length).toBeGreaterThan(0);
  });
});
