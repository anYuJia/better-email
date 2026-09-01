import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import UndoSnackbarStack from './UndoSnackbarStack';

afterEach(cleanup);

describe('UndoSnackbarStack', () => {
  it('presents a concise atomic update with explicit undo and dismiss actions', () => {
    const onUndoAction = vi.fn();
    const onDismissAction = vi.fn();

    render(
      <UndoSnackbarStack
        undoAction={{
          id: 'bulk-archive',
          title: '批量归档',
          detail: '40 封邮件',
          snapshots: [],
        }}
        onUndoAction={onUndoAction}
        onDismissAction={onDismissAction}
      />,
    );

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(status.textContent).toContain('批量归档');
    expect(status.textContent).toContain('40 封邮件');

    fireEvent.click(screen.getByRole('button', { name: '撤销批量归档' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭撤销提示' }));
    expect(onUndoAction).toHaveBeenCalledTimes(1);
    expect(onDismissAction).toHaveBeenCalledTimes(1);
  });
});
