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

  it('supports quick presets and updates the draft dates', () => {
    render(<MessageDateRangePicker onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '按日期范围筛选邮件' }));

    const preset7Days = screen.getByRole('button', { name: '近 7 天' });
    expect(preset7Days).not.toBeNull();
    fireEvent.click(preset7Days);

    const startInput = screen.getByLabelText('开始日期') as HTMLInputElement;
    const endInput = screen.getByLabelText('结束日期') as HTMLInputElement;
    expect(startInput.value).toBeTruthy();
    expect(endInput.value).toBeTruthy();
    expect(startInput.value <= endInput.value).toBe(true);
  });

  it('supports keyboard navigation in CalendarSelect combobox', () => {
    // Mock scrollIntoView in jsdom
    const scrollMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollMock;

    render(<MessageDateRangePicker onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '按日期范围筛选邮件' }));

    const monthCombobox = screen.getByRole('combobox', { name: '开始月份' });
    expect(monthCombobox.getAttribute('aria-expanded')).toBe('false');

    // ArrowDown opens the listbox
    fireEvent.keyDown(monthCombobox, { key: 'ArrowDown' });
    expect(monthCombobox.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('listbox', { name: '开始月份' })).not.toBeNull();
    expect(scrollMock).toHaveBeenCalled();

    // ArrowDown moves active descendant
    fireEvent.keyDown(monthCombobox, { key: 'ArrowDown' });
    expect(monthCombobox.getAttribute('aria-activedescendant')).toBeTruthy();

    // Escape closes listbox
    fireEvent.keyDown(monthCombobox, { key: 'Escape' });
    expect(monthCombobox.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox', { name: '开始月份' })).toBeNull();
  });
});
