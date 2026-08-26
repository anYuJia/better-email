import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import ComposerSchedulePicker from './ComposerSchedulePicker';

function localValue(offsetDays = 3, hour = 12, minute = 30) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  date.setHours(hour, minute, 0, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function ControlledPicker({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return <ComposerSchedulePicker value={value} onChange={setValue} />;
}

describe('ComposerSchedulePicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses a transactional app-owned calendar instead of the native datetime picker', () => {
    const onChange = vi.fn();
    const initial = localValue();
    const nextDate = new Date(initial);
    nextDate.setDate(nextDate.getDate() + 1);
    const normalizedNext = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}T${String(nextDate.getHours()).padStart(2, '0')}:${String(nextDate.getMinutes()).padStart(2, '0')}`;
    render(<ComposerSchedulePicker value={initial} onChange={onChange} />);

    expect(screen.getByRole('button', { name: '定时发送时间' }).textContent).toContain(`${new Date(initial).getMonth() + 1}月`);
    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));

    expect(screen.getByRole('dialog', { name: '选择定时发送时间' })).not.toBeNull();
    expect(screen.queryByDisplayValue(initial)).toBeNull();
    expect(screen.getByRole('gridcell', { name: dateLabel(initial) }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('gridcell', { name: dateLabel(normalizedNext) }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '选择定时发送时间' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(normalizedNext);
  });

  it('keeps date and time edits local until confirm', () => {
    const initial = localValue();
    const initialDate = new Date(initial);
    const nextHour = (initialDate.getHours() + 1) % 24;
    const expected = `${initial.slice(0, 11)}${String(nextHour).padStart(2, '0')}:${initial.slice(14)}`;
    const onChange = vi.fn();
    render(<ComposerSchedulePicker value={initial} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));
    fireEvent.click(screen.getByRole('combobox', { name: '小时' }));
    fireEvent.click(screen.getByRole('option', { name: String(nextHour).padStart(2, '0') }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '选择定时发送时间' }).textContent).toContain(`${String(nextHour).padStart(2, '0')}:${initial.slice(14)}`);
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onChange).toHaveBeenCalledWith(expected);
  });

  it('confirms once from the picker header and validates future time', () => {
    const onChange = vi.fn();
    const initial = localValue();
    render(<ComposerSchedulePicker value={initial} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));
    const confirm = screen.getByRole('button', { name: '确定' });
    expect(confirm).not.toHaveProperty('disabled', true);
    fireEvent.click(confirm);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps today and outside/Escape cancellation local', () => {
    const initial = localValue();
    render(<ControlledPicker initialValue={initial} />);

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));
    fireEvent.click(screen.getByRole('button', { name: '今天' }));
    expect(screen.getByRole('dialog', { name: '选择定时发送时间' })).not.toBeNull();

    fireEvent.keyDown(screen.getByRole('button', { name: '今天' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
