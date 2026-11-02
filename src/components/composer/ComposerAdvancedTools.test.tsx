import { useState, type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComposeTemplate } from '../../app/types';
import ComposerAdvancedTools from './ComposerAdvancedTools';
import useComposerTemplates from '../../hooks/useComposerTemplates';
import { emptyDraft } from '../../app/composerConfig';

const template: ComposeTemplate = {
  id: 'weekly', name: '项目周报', subject: '本周进展', body: '正文', html_body: '',
  category: '', tags: [], account_id: 0, is_favorite: false,
  created_at: '2026-10-30T00:00:00Z', updated_at: '2026-10-30T00:00:00Z',
};

function props(overrides: Partial<ComponentProps<typeof ComposerAdvancedTools>> = {}) {
  return {
    mode: 'more' as const,
    templates: [template],
    templateName: '',
    onClose: vi.fn(),
    onApplyTemplate: vi.fn(),
    onDeleteTemplate: vi.fn(),
    onTemplateNameChange: vi.fn(),
    onSaveTemplate: vi.fn(),
    onSaveDraft: vi.fn(),
    signature: '团队签名',
    onInsertSignature: vi.fn(),
    onOpenTemplates: vi.fn(),
    ...overrides,
  };
}

describe('ComposerAdvancedTools mobile overflow', () => {
  afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('retains an inert template presentation during exit and cancels removal on quick reopening', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const actions = props({ mode: 'templates', templateName: '项目模板' });
    const { rerender } = render(<ComposerAdvancedTools {...actions} />);
    fireEvent.click(screen.getByRole('button', { name: '保存为模板…' }));
    const panel = screen.getByRole('dialog', { name: '邮件模板' });
    const input = screen.getByRole('textbox', { name: '模板名称' });
    rerender(<ComposerAdvancedTools {...actions} mode={null} />);
    expect(screen.queryByRole('dialog', { name: '邮件模板' })).toBeNull();
    expect(panel.isConnected).toBe(true);
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.contains(input)).toBe(true);
    expect(fireEvent.keyDown(document, { key: 'Escape' })).toBe(true);
    act(() => vi.advanceTimersByTime(60));
    rerender(<ComposerAdvancedTools {...actions} />);
    expect(screen.getByRole('dialog', { name: '邮件模板' })).toBe(panel);
    expect(screen.getByRole('textbox', { name: '模板名称' })).toBe(input);
    expect(document.activeElement).toBe(input);
    act(() => vi.advanceTimersByTime(120));
    expect(panel.isConnected).toBe(true);
    rerender(<ComposerAdvancedTools {...actions} mode={null} />);
    const outside = document.createElement('button');
    document.body.append(outside); outside.focus();
    act(() => vi.advanceTimersByTime(120));
    expect(panel.isConnected).toBe(false);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('removes the outgoing menu immediately with reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const actions = props();
    const { rerender } = render(<ComposerAdvancedTools {...actions} />);
    const panel = screen.getByRole('menu', { name: '更多写信工具' });
    rerender(<ComposerAdvancedTools {...actions} mode={null} />);
    expect(panel.isConnected).toBe(false);
  });

  it('repositions a growing template panel without losing the focused name or selection', () => {
    let notifyResize: (() => void) | undefined;
    const observed: Element[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as ResizeObserver);
      }
      observe(target: Element) { observed.push(target); }
      unobserve() {}
      disconnect = disconnect;
    });
    const anchor = document.createElement('button');
    let panelHeight = 180;
    const anchorTop = window.innerHeight - 68;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === anchor) return new DOMRect(100, anchorTop, 80, 36);
      if (this.classList.contains('composer-advanced-popover')) return new DOMRect(0, 0, 360, panelHeight);
      return new DOMRect();
    });
    const { unmount } = render(<ComposerAdvancedTools {...props({
      mode: 'templates', templates: [], anchorRef: { current: anchor }, templateName: '项目模板',
    })} />);
    fireEvent.click(screen.getByRole('button', { name: '保存为模板…' }));
    const panel = screen.getByRole('dialog', { name: '邮件模板' });
    const name = screen.getByRole('textbox', { name: '模板名称' }) as HTMLInputElement;
    name.setSelectionRange(1, 3);
    expect(Number.parseFloat(panel.style.top)).toBe(anchorTop - panelHeight - 8);
    expect(observed).toContain(panel);
    expect(observed).toContain(anchor);

    // Font scaling / a late font load changes layout without React props or a
    // window resize. Re-anchor the larger box before it can escape the viewport.
    panelHeight = 460;
    act(() => notifyResize?.());
    expect(Number.parseFloat(panel.style.top)).toBe(anchorTop - panelHeight - 8);
    expect(Number.parseFloat(panel.style.top) + panelHeight).toBeLessThan(window.innerHeight);
    expect(document.activeElement).toBe(name);
    expect(name.selectionStart).toBe(1);
    expect(name.selectionEnd).toBe(3);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('preserves the selected menu action during parent updates and uses the latest close callback', () => {
    const actions = props();
    const { rerender } = render(<ComposerAdvancedTools {...actions} />);
    const templates = screen.getByRole('menuitem', { name: '插入模板…' });
    templates.focus();
    const latestClose = vi.fn();
    rerender(<ComposerAdvancedTools {...actions} onClose={latestClose} />);
    expect(document.activeElement).toBe(templates);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(latestClose).toHaveBeenCalledTimes(1);
    expect(actions.onClose).not.toHaveBeenCalled();
  });

  it('keeps save available and inserts a signature before closing the menu', () => {
    const onInsertSignature = vi.fn();
    const onClose = vi.fn();
    const actions = props({ onInsertSignature, onClose });
    render(<ComposerAdvancedTools {...actions} />);

    const save = screen.getByRole('menuitem', { name: '保存并关闭' });
    expect(document.activeElement).toBe(save);
    fireEvent.click(save);
    expect(actions.onSaveDraft).toHaveBeenCalledTimes(1);
    expect(actions.onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('menuitem', { name: '插入签名' }));
    expect(actions.onInsertSignature).toHaveBeenCalledTimes(1);
    expect(actions.onClose).toHaveBeenCalledTimes(1);
    expect(onInsertSignature.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('opens templates without closing or restoring focus to the hidden direct trigger', () => {
    const actions = props();
    const { rerender } = render(<ComposerAdvancedTools {...actions} />);

    fireEvent.click(screen.getByRole('menuitem', { name: '插入模板…' }));
    expect(actions.onOpenTemplates).toHaveBeenCalledTimes(1);
    expect(actions.onClose).not.toHaveBeenCalled();
    rerender(<ComposerAdvancedTools {...actions} mode="templates" />);

    const apply = screen.getByRole('menuitem', { name: '项目周报' });
    expect(document.activeElement).toBe(apply);
    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toBe(apply);
    fireEvent.click(apply);
    expect(actions.onApplyTemplate).toHaveBeenCalledWith(template);
    expect(actions.onClose).toHaveBeenCalledTimes(1);
  });

  it('skips an unavailable signature during keyboard navigation', () => {
    render(<ComposerAdvancedTools {...props({ signature: '' })} />);
    const signature = screen.getByRole('menuitem', { name: '插入签名' });
    const save = screen.getByRole('menuitem', { name: '保存并关闭' });
    const templates = screen.getByRole('menuitem', { name: '插入模板…' });

    expect(signature.hasAttribute('disabled')).toBe(true);
    expect(signature.getAttribute('title')).toBe('当前发件身份未设置签名');
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(templates);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toBe(templates);
    fireEvent.keyDown(document, { key: 'Home' });
    expect(document.activeElement).toBe(save);
  });

  it('blocks all overflow actions while saving a draft', () => {
    const actions = props({ saveDraftPending: true });
    render(<ComposerAdvancedTools {...actions} />);

    for (const item of screen.getAllByRole('menuitem')) {
      expect(item.hasAttribute('disabled')).toBe(true);
      fireEvent.click(item);
    }
    expect(screen.getByRole('menuitem', { name: '正在保存…' }).getAttribute('aria-busy')).toBe('true');
    expect(actions.onSaveDraft).not.toHaveBeenCalled();
    expect(actions.onInsertSignature).not.toHaveBeenCalled();
    expect(actions.onOpenTemplates).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(actions.onClose).not.toHaveBeenCalled();
  });

  function TemplateHarness({ body = '', onStatus = () => {} }: { body?: string; onStatus?: Dispatch<SetStateAction<string>> }) {
    const templates = useComposerTemplates({
      draft: { ...emptyDraft, body }, setDraft: () => {}, setRichComposer: () => {}, setStatus: onStatus,
    });
    const [mode, setMode] = useState<'templates' | null>('templates');
    return <ComposerAdvancedTools {...props()} mode={mode} templates={templates.composeTemplates}
      templateName={templates.templateName} onTemplateNameChange={templates.setTemplateName}
      onSaveTemplate={templates.saveDraftAsTemplate} onClose={() => setMode(null)} />;
  }

  it('keeps a rejected empty template and its name open, then closes after content is saved', () => {
    const onStatus = vi.fn();
    const { rerender } = render(<TemplateHarness onStatus={onStatus} />);
    fireEvent.click(screen.getByRole('button', { name: '保存为模板…' }));
    const name = screen.getByRole('textbox', { name: '模板名称' }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: '工作模板' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert').textContent).toBe('请先填写主题或正文后再保存模板');
    expect(name.value).toBe('工作模板');
    expect(document.activeElement).toBe(name);
    expect(JSON.parse(localStorage.getItem('better-email.composeTemplates')!)).toEqual([]);
    expect(onStatus).not.toHaveBeenCalled();

    rerender(<TemplateHarness body="可重复使用的正文" onStatus={onStatus} />);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.queryByRole('dialog', { name: '邮件模板' })).toBeNull();
    expect(JSON.parse(localStorage.getItem('better-email.composeTemplates')!)).toEqual([
      expect.objectContaining({ name: '工作模板', body: '可重复使用的正文' }),
    ]);
    expect(onStatus).toHaveBeenCalledExactlyOnceWith('模板已保存：工作模板');
  });

  it('keeps the template name and reports a storage failure so saving can be retried', () => {
    render(<TemplateHarness body="需要保留的正文" />);
    fireEvent.click(screen.getByRole('button', { name: '保存为模板…' }));
    const name = screen.getByRole('textbox', { name: '模板名称' }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: '保留名称' } });
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('空间不足'); });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert').textContent).toBe('模板未保存：空间不足');
    expect(name.value).toBe('保留名称');
    expect(document.activeElement).toBe(name);
    storage.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.queryByRole('dialog', { name: '邮件模板' })).toBeNull();
  });
});
