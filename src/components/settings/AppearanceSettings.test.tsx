import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppearanceSettings from './AppearanceSettings';

describe('AppearanceSettings', () => {
  afterEach(cleanup);

  it('renders a compact segmented theme control with the selected description', () => {
    render(<AppearanceSettings themeMode="dark" onThemeModeChange={vi.fn()} />);

    const group = screen.getByRole('radiogroup', { name: '界面外观' });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '深色：始终使用深色界面' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: '浅色：始终使用浅色界面' }).getAttribute('title')).toBe('始终使用浅色界面');
    expect(screen.getByText('界面主题')).toBeDefined();
    expect(screen.getByText('始终使用深色界面')).toBeDefined();
  });

  it('changes the selection with arrow keys and moves focus to the next option', () => {
    const onThemeModeChange = vi.fn();
    render(<AppearanceSettings themeMode="system" onThemeModeChange={onThemeModeChange} />);

    const group = screen.getByRole('radiogroup', { name: '界面外观' });
    fireEvent.keyDown(group, { key: 'ArrowRight' });

    const lightOption = screen.getByRole('radio', { name: '浅色：始终使用浅色界面' });
    expect(onThemeModeChange).toHaveBeenCalledWith('light');
    expect(document.activeElement).toBe(lightOption);
  });
});
