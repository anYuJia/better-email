import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ReaderSubject from './ReaderSubject';

afterEach(cleanup);

describe('ReaderSubject', () => {
  it('offers an accessible expansion control for long subjects', () => {
    const subject = '项目进展与后续安排'.repeat(8);
    render(<ReaderSubject subject={subject} />);

    const title = screen.getByRole('heading', { level: 1, name: subject });
    const toggle = screen.getByRole('button', { name: '展开完整主题' });
    expect(title.className).toContain('reader-title-block--clamped');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    expect(title.className).not.toContain('reader-title-block--clamped');
    expect(screen.getByRole('button', { name: '收起完整主题' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps short subjects compact without an extra control', () => {
    render(<ReaderSubject subject="周会纪要" />);
    expect(screen.getByRole('heading', { level: 1, name: '周会纪要' })).toBeDefined();
    expect(screen.queryByRole('button', { name: '展开完整主题' })).toBeNull();
  });
});
