import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import ReaderLabelMenu from './ReaderLabelMenu';
import type { Label } from '../../app/types';

afterEach(() => {
  cleanup();
});

const labels: Label[] = [
  { id: 1, name: '工作', color: '#2f7ed8', message_count: 0 },
];

function openLabelMenu() {
  render(
    <ReaderLabelMenu
      selectedLabels={[]}
      labels={labels}
      onToggleLabel={vi.fn()}
      onCreateLabel={vi.fn()}
      onDeleteLabel={vi.fn()}
    />,
  );
  const summary = document.querySelector('.label-menu summary') as HTMLElement;
  fireEvent.click(summary);
  const details = document.querySelector('.label-menu') as HTMLElement;
  details.setAttribute('open', '');
}

describe('ReaderLabelMenu accessibility', () => {
  it('gives every color button a semantic name and pressed state', () => {
    openLabelMenu();
    expect(screen.getByRole('button', { name: '使用蓝色标签颜色' })).toBeDefined();
    expect(screen.getByRole('button', { name: '使用绿色标签颜色' })).toBeDefined();
    expect(screen.getByRole('button', { name: '使用红色标签颜色' })).toBeDefined();
    // 默认选中的蓝色应标记 aria-pressed。
    expect(screen.getByRole('button', { name: '使用蓝色标签颜色' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '使用绿色标签颜色' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('names the new-label submit button instead of exposing a bare plus', () => {
    openLabelMenu();
    const submit = screen.getByRole('button', { name: '新建标签' });
    expect(submit).toBeDefined();
    expect(submit.hasAttribute('disabled')).toBe(true);
  });

  it('keeps accessible names for edit and delete actions', () => {
    openLabelMenu();
    expect(screen.getByRole('button', { name: '编辑名称' })).toBeDefined();
    expect(screen.getByRole('button', { name: '删除标签' })).toBeDefined();
  });
});
