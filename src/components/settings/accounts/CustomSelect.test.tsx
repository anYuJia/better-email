import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CustomSelect } from './CustomSelect';

describe('CustomSelect', () => {
  afterEach(() => {
    cleanup();
  });

  const options = [
    { value: '5', label: '5 秒' },
    { value: '10', label: '10 秒', meta: '推荐' },
    { value: '30', label: '30 秒' },
  ];

  it('renders the active option in the trigger', () => {
    render(<CustomSelect value="10" options={options} onChange={() => undefined} />);
    expect(screen.getByText('10 秒')).not.toBeNull();
    expect(screen.getByText('推荐')).not.toBeNull();
    const trigger = screen.getByRole('button', { expanded: false });
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
  });

  it('opens the option list and selects a value', () => {
    const onChange = vi.fn();
    render(<CustomSelect value="5" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const list = screen.getByRole('listbox');
    expect(list).not.toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /30 秒/ }));
    expect(onChange).toHaveBeenCalledWith('30');
  });

  it('closes on Escape and restores focus to the trigger', () => {
    render(<CustomSelect value="5" options={options} onChange={() => undefined} />);
    const trigger = screen.getByRole('button', { expanded: false });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('marks the active option as selected', () => {
    render(<CustomSelect value="10" options={options} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const activeOption = screen.getByRole('option', { name: /10 秒/ });
    expect(activeOption.getAttribute('aria-selected')).toBe('true');
  });
});
