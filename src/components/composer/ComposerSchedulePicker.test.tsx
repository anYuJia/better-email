import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import ComposerSchedulePicker from './ComposerSchedulePicker';

function ControlledPicker({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  return <ComposerSchedulePicker value={value} onChange={setValue} />;
}

describe('ComposerSchedulePicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('uses an app-owned calendar instead of the native datetime picker', () => {
    const onChange = vi.fn();
    render(<ComposerSchedulePicker value="2026-08-25T12:30" onChange={onChange} />);

    expect(screen.getByRole('button', { name: '定时发送时间' }).textContent).toContain('8月25日 · 12:30');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));

    expect(screen.getByRole('dialog', { name: '选择定时发送时间' })).not.toBeNull();
    expect(screen.getByText('2026年8月')).not.toBeNull();
    expect(screen.getByRole('gridcell', { name: '2026年8月25日' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByDisplayValue('2026-08-25T12:30')).toBeNull();

    fireEvent.click(screen.getByRole('gridcell', { name: '2026年8月26日' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-08-26T12:30');
  });

  it('keeps date and time changes in the existing datetime-local value format', () => {
    render(<ControlledPicker initialValue="2026-08-25T12:30" />);

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));
    fireEvent.click(screen.getByRole('combobox', { name: '小时' }));
    fireEvent.click(screen.getByRole('option', { name: '15' }));
    fireEvent.click(screen.getByRole('combobox', { name: '分钟' }));
    fireEvent.click(screen.getByRole('option', { name: '45' }));

    expect(screen.getByRole('button', { name: '定时发送时间' }).textContent).toContain('8月25日 · 15:45');
  });

  it('can clear an existing schedule without opening a native input', () => {
    render(<ControlledPicker initialValue="2026-08-25T12:30" />);

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));
    fireEvent.click(screen.getByRole('button', { name: '清除定时' }));

    expect(screen.getByRole('button', { name: '定时发送时间' }).textContent).toContain('选择发送时间');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape without letting the parent composer receive it', () => {
    render(<ControlledPicker initialValue="2026-08-25T12:30" />);

    fireEvent.click(screen.getByRole('button', { name: '定时发送时间' }));
    const parentEscape = vi.fn();
    document.addEventListener('keydown', parentEscape);
    fireEvent.keyDown(screen.getByRole('button', { name: '今天' }), { key: 'Escape' });
    document.removeEventListener('keydown', parentEscape);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(parentEscape).not.toHaveBeenCalled();
  });
});
