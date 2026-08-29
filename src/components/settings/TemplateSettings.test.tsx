import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import TemplateSettings from './TemplateSettings';
import { composeTemplatesStorageKey } from '../../app/templateStore';
import { aiServiceStorageKey } from '../../app/aiServiceConfig';

function seedTemplates() {
  window.localStorage.setItem(composeTemplatesStorageKey, JSON.stringify([
    {
      id: 'tpl-1',
      name: '跟进客户',
      subject: '跟进：{{contact.name}}',
      body: '您好 {{contact.name}}，\n{{today}}',
      html_body: '',
      category: '商务',
      tags: ['销售', '客户'],
      account_id: 0,
      is_favorite: true,
      created_at: '2026-06-01T08:00:00Z',
      updated_at: '2026-07-01T08:00:00Z',
    },
    {
      id: 'tpl-2',
      name: '感谢信',
      subject: '感谢',
      body: '感谢你的支持。',
      html_body: '',
      category: '',
      tags: [],
      account_id: 0,
      is_favorite: false,
      created_at: '2026-06-02T08:00:00Z',
      updated_at: '2026-06-02T08:00:00Z',
    },
  ]));
}

describe('TemplateSettings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedTemplates();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('renders the template list with metadata and actions', () => {
    render(<TemplateSettings />);
    expect(screen.getByText('跟进客户')).not.toBeNull();
    expect(screen.getByText('感谢信')).not.toBeNull();
    expect(screen.getByText('跟进：{{contact.name}}')).not.toBeNull();
    expect(screen.getByText('商务')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /编辑/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /复制/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /删除/ })).toHaveLength(2);
  });

  it('opens the editor when creating a new template', () => {
    render(<TemplateSettings />);
    fireEvent.click(screen.getByRole('button', { name: /新建模板/ }));
    expect(screen.getByRole('heading', { name: '新建模板' })).not.toBeNull();
    expect(screen.getByLabelText('模板名称')).not.toBeNull();
    expect(screen.getByLabelText('邮件主题')).not.toBeNull();
  });

  it('shows the empty state with AI guidance', () => {
    window.localStorage.setItem(composeTemplatesStorageKey, '[]');
    render(<TemplateSettings />);
    expect(screen.getByText('暂无模板')).not.toBeNull();
    expect(screen.getByText('新建一个模板，或使用 AI 辅助生成。')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /新建模板/ }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: /AI 生成/ }).length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the AI generate entry available and collapses the card by default', () => {
    render(<TemplateSettings />);
    expect(screen.getByRole('button', { name: /AI 生成/ })).not.toBeNull();
    const toggle = screen.getByRole('button', { name: /AI 辅助生成模板/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('inserts variables into the active field when a variable chip is clicked', () => {
    render(<TemplateSettings />);
    fireEvent.click(screen.getByRole('button', { name: /新建模板/ }));
    const body = screen.getByLabelText('正文');
    fireEvent.focus(body);
    fireEvent.click(screen.getByRole('button', { name: /{{today}}/ }));
    expect((body as HTMLTextAreaElement).value).toContain('{{today}}');
  });

  it('renders a preview with sample values while editing', () => {
    render(<TemplateSettings />);
    fireEvent.click(screen.getByRole('button', { name: /新建模板/ }));
    const subject = screen.getByLabelText('邮件主题');
    fireEvent.change(subject, { target: { value: '您好 {{contact.name}}' } });
    expect(screen.getByText('预览（使用示例联系人）')).not.toBeNull();
    expect(screen.getByText('您好 示例联系人')).not.toBeNull();
  });

  it('asks for confirmation before deleting a template', () => {
    render(<TemplateSettings />);
    fireEvent.click(screen.getByRole('button', { name: /删除 跟进客户/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('删除模板')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '确认' }));
    expect(screen.queryByText('跟进客户')).toBeNull();
  });

  it('hints to configure AI service when it is disabled', () => {
    window.localStorage.setItem(aiServiceStorageKey, JSON.stringify({ enabled: false }));
    render(<TemplateSettings />);
    fireEvent.click(screen.getByRole('button', { name: /AI 辅助生成模板/ }));
    expect(screen.getByText(/AI 接入尚未开启/)).not.toBeNull();
  });
});
