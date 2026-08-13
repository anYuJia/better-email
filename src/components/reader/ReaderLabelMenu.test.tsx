import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
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

function ControlledReaderLabelMenu() {
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  return (
    <ReaderLabelMenu
      selectedLabels={selectedLabels}
      labels={labels}
      onToggleLabel={(label) => {
        setSelectedLabels((current) =>
          current.includes(label.name)
            ? current.filter((name) => name !== label.name)
            : [...current, label.name],
        );
      }}
      onCreateLabel={vi.fn()}
      onDeleteLabel={vi.fn()}
    />
  );
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

  it('keeps label chips and active state in sync after add, remove, and add', () => {
    render(<ControlledReaderLabelMenu />);
    const summary = document.querySelector('.label-menu summary') as HTMLElement;
    fireEvent.click(summary);
    const details = document.querySelector('.label-menu') as HTMLElement;
    details.setAttribute('open', '');

    const activeLabelCount = () => document.querySelectorAll('.active-label-chip').length;
    const labelButton = screen.getByRole('button', { name: '工作' });

    expect(labelButton.className).toContain('label-select-btn');
    expect(labelButton.className).not.toContain('active');
    expect(activeLabelCount()).toBe(0);

    fireEvent.click(labelButton);
    expect(labelButton.className).toContain('active');
    expect(activeLabelCount()).toBe(1);

    fireEvent.click(labelButton);
    expect(labelButton.className).not.toContain('active');
    expect(activeLabelCount()).toBe(0);

    fireEvent.click(labelButton);
    expect(labelButton.className).toContain('active');
    expect(activeLabelCount()).toBe(1);
  });
});
