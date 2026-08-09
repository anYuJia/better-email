import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppearanceSettings from './AppearanceSettings';

describe('AppearanceSettings', () => {
  afterEach(cleanup);

  it('renders a compact radio group with the selected mode description', () => {
    render(<AppearanceSettings themeMode="dark" onThemeModeChange={vi.fn()} />);

    const group = screen.getByRole('radiogroup', { name: '界面外观' });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /^暗色：/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('始终使用深色的界面外观。')).toBeDefined();
  });

  it('changes the selection with arrow keys and moves focus to the next option', () => {
    const onThemeModeChange = vi.fn();
    render(<AppearanceSettings themeMode="system" onThemeModeChange={onThemeModeChange} />);

    const group = screen.getByRole('radiogroup', { name: '界面外观' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });

    const lightOption = screen.getByRole('radio', { name: /^亮色：/ });
    expect(onThemeModeChange).toHaveBeenCalledWith('light');
    expect(document.activeElement).toBe(lightOption);
  });
});
