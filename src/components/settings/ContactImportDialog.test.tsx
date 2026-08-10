import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ContactImportDialog from './ContactImportDialog';

const preview = {
  path: '/mock/people.csv',
  file_name: 'people.csv',
  format: 'csv' as const,
  total_count: 1,
  entries: [
    {
      email: 'a@example.com',
      name: 'A',
      aliases: [] as string[],
      vip: false,
      status: 'new' as const,
      existing_contact_id: null,
      existing_name: '',
      reason: '新联系人',
    },
  ],
  new_count: 1,
  merge_count: 0,
  duplicate_count: 0,
  invalid_count: 0,
};

describe('ContactImportDialog error handling', () => {
  afterEach(() => cleanup());

  function renderDialog(props: Partial<Parameters<typeof ContactImportDialog>[0]> = {}) {
    const onCancel = vi.fn();
    const onPickFile = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ContactImportDialog
        open
        preview={null}
        commitResult={null}
        selectionMap={{}}
        entryEdits={{}}
        previewing={false}
        importing={false}
        importError={null}
        onSetSelection={() => undefined}
        onSetAllSelection={() => undefined}
        onSetEntryEdit={() => undefined}
        onPickFile={onPickFile}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onOpenHistory={() => undefined}
        {...props}
      />,
    );
    return { onCancel, onPickFile, onConfirm };
  }

  it('retries with the file picker and stays dismissible from the error state', () => {
    const { onCancel } = renderDialog({
      importError: '文件大小超过 5 MB 限制。',
      previewing: true,
    });

    const busyRetry = screen.getByRole('button', { name: '正在读取文件…' });
    expect(busyRetry).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    // 重新渲染为非 busy 状态后，重试入口重新可用。
    cleanup();
    const { onPickFile: onPickAgain } = renderDialog({
      importError: '文件大小超过 5 MB 限制。',
      previewing: false,
    });
    fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }));
    expect(onPickAgain).toHaveBeenCalledTimes(1);
  });

  it('shows the commit error inside the preview state with a retry on 确认导入', () => {
    const { onConfirm } = renderDialog({ preview, importError: '联系人导入失败：本地数据库写入失败。' });

    expect(screen.getByRole('alert').textContent).toContain('导入失败');
    expect(screen.getByRole('alert').textContent).toContain('本地数据库写入失败');
    fireEvent.click(screen.getByRole('button', { name: /确认导入/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('explains skipped duplicates and the post-import list ordering', () => {
    renderDialog({
      commitResult: { batch_id: 1, created: 2, merged: 0, skipped: 3 },
    });

    expect(screen.getByText(/重复.*跳过/)).toBeTruthy();
    expect(screen.getByText(/不按文件原始顺序显示/)).toBeTruthy();
  });

  it('gives initial focus inside the dialog and restores it on close', () => {
    const outside = document.createElement('button');
    outside.textContent = '外部按钮';
    document.body.appendChild(outside);
    try {
      outside.focus();
      renderDialog({ importError: '文件解析失败' });

      // 初始焦点进入弹窗内（优先关闭按钮 / 首个可交互元素）。
      const dialog = document.querySelector('.contact-import-dialog') as HTMLElement;
      expect(dialog).not.toBeNull();
      expect(dialog.contains(document.activeElement)).toBe(true);

      // 关闭后焦点恢复到打开弹窗前的元素。
      cleanup();
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });

  it('traps Tab focus inside the dialog and closes on Escape unless importing', () => {
    const { onCancel } = renderDialog({ preview: null });
    const dialog = document.querySelector('.contact-import-dialog') as HTMLElement;

    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    // Escape 关闭（未在导入中）。
    const outerEscapeHandler = vi.fn();
    window.addEventListener('keydown', outerEscapeHandler);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(outerEscapeHandler).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outerEscapeHandler);
  });

  it('never closes on Escape or backdrop while importing', () => {
    const { onCancel } = renderDialog({ importing: true, preview: null });
    const dialog = document.querySelector('.contact-import-dialog') as HTMLElement;
    const outerEscapeHandler = vi.fn();
    window.addEventListener('keydown', outerEscapeHandler);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(outerEscapeHandler).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outerEscapeHandler);
  });

  it('elevates each action dropdown above the contact-import portal', () => {
    renderDialog({ preview });
    fireEvent.click(screen.getByRole('button', { name: 'A 导入操作' }));

    const listbox = screen.getByRole('listbox');
    expect((listbox as HTMLElement).style.zIndex).toBe('2650');
    expect(listbox.getAttribute('data-portal-layer')).toBe('2650');
  });

  it('keeps Tab and Shift+Tab inside the dialog and its owned body-portal menu', () => {
    renderDialog({ preview });
    const trigger = screen.getByRole('button', { name: 'A 导入操作' });
    fireEvent.click(trigger);

    const dialog = document.querySelector('.contact-import-dialog') as HTMLElement;
    const listbox = screen.getByRole('listbox');
    const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options.length).toBeGreaterThan(1);
    const firstDialogFocusable = dialog.querySelector<HTMLElement>('button:not([disabled])');
    const lastMenuOption = options[options.length - 1];
    expect(firstDialogFocusable).not.toBeNull();

    // The menu is portaled outside the dialog, but its last option still wraps
    // back to the first dialog control instead of leaking into the app shell.
    lastMenuOption.focus();
    fireEvent.keyDown(lastMenuOption, { key: 'Tab' });
    expect(document.activeElement).toBe(firstDialogFocusable);

    // Reverse traversal from the first dialog control reaches the owned menu.
    firstDialogFocusable?.focus();
    fireEvent.keyDown(firstDialogFocusable!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastMenuOption);
  });

  it('lets Escape close the owned menu without closing the import dialog', () => {
    const { onCancel } = renderDialog({ preview });
    const trigger = screen.getByRole('button', { name: 'A 导入操作' });
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: '新增' });
    fireEvent.keyDown(option, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.querySelector('.contact-import-dialog')).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('disables every editable import control while committing', () => {
    renderDialog({ preview, importing: true });

    expect(screen.getByRole('button', { name: '全部新增' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'A 导入操作' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '编辑 A' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '正在导入…' })).toHaveProperty('disabled', true);
  });
});
