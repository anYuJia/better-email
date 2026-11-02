import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReaderLabelMenu from './ReaderLabelMenu';
import type { Label } from '../../app/types';

const labels: Label[] = [
  { id: 1, name: '紧急', color: '#cf222e', message_count: 2 },
  { id: 2, name: '项目', color: '#8250df', message_count: 3 },
];
afterEach(cleanup);
function open() { fireEvent.click(screen.getByRole('button', { name: '标签' })); }

describe('ReaderLabelMenu editing', () => {
  it.each([{ isComposing: true }, { keyCode: 229 }])('waits for IME completion before creating or renaming (%j)', async (composition) => {
    const create = vi.fn().mockResolvedValue({ ...labels[0], id: 3 });
    const update = vi.fn().mockResolvedValue(undefined);
    render(<ReaderLabelMenu selectedLabels={[]} labels={labels} onToggleLabel={vi.fn()} onCreateLabel={create} onUpdateLabel={update} />);
    open();
    const name = screen.getByRole('textbox', { name: '新标签名称' });
    fireEvent.change(name, { target: { value: '正在输入' } });
    fireEvent.keyDown(name, { key: 'Enter', ...composition });
    expect(create).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(name, { key: 'Enter' }); });
    expect(create).toHaveBeenCalledExactlyOnceWith('正在输入', '#2f7ed8');
    fireEvent.click(screen.getByRole('button', { name: '编辑标签 紧急' }));
    const rename = screen.getByRole('textbox', { name: '修改标签 紧急 的名称' });
    fireEvent.change(rename, { target: { value: '重要事项' } });
    fireEvent.keyDown(rename, { key: 'Enter', ...composition });
    expect(update).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(rename, { key: 'Enter' }); });
    expect(update).toHaveBeenCalledExactlyOnceWith(1, '重要事项', '#cf222e');
    fireEvent.change(name, { target: { value: '独立新建颜色' } });
    await act(async () => { fireEvent.keyDown(name, { key: 'Enter' }); });
    expect(create).toHaveBeenLastCalledWith('独立新建颜色', '#2f7ed8');
  });

  it('names each action by its target and preserves the label identity when deleting', () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    render(<ReaderLabelMenu selectedLabels={[]} labels={labels} onToggleLabel={vi.fn()} onDeleteLabel={remove} />);
    open();
    expect(screen.getByRole('button', { name: '编辑标签 项目' }).querySelector('svg')).not.toBeNull();
    const deleteButton = screen.getByRole('button', { name: '删除标签 项目' });
    expect(deleteButton.querySelector('svg')).not.toBeNull();
    fireEvent.click(deleteButton);
    expect(remove).toHaveBeenCalledExactlyOnceWith(2);
  });
});
