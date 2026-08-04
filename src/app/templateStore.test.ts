import { describe, expect, it, beforeEach } from 'vitest';
import {
  TEMPLATE_VARIABLES,
  deleteTemplate,
  duplicateTemplate,
  loadTemplates,
  migrateLegacyTemplate,
  parseAiGeneratedTemplate,
  persistTemplates,
  saveTemplate,
  substituteTemplateVariables,
} from './templateStore';

describe('template store', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('migrates legacy localStorage templates without data loss', () => {
    window.localStorage.setItem('better-email.composeTemplates', JSON.stringify([
      { id: 't1', name: 'Legacy', subject: 'Hi', body: 'Hello', html_body: '<p>Hello</p>' },
    ]));
    const templates = loadTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('Legacy');
    expect(templates[0].subject).toBe('Hi');
    expect(templates[0].body).toBe('Hello');
    expect(templates[0].html_body).toBe('<p>Hello</p>');
    expect(templates[0].category).toBe('');
    expect(templates[0].tags).toEqual([]);
    expect(templates[0].is_favorite).toBe(false);
  });

  it('saves, deletes and duplicates templates', () => {
    const saved = saveTemplate({
      id: 'a',
      name: 'Follow Up',
      subject: '{{contact.name}} 跟进',
      body: '你好 {{contact.name}}',
      html_body: '',
      category: '商务',
      tags: ['跟进'],
      account_id: 0,
      is_favorite: true,
      created_at: '',
      updated_at: '',
    });
    expect(loadTemplates()).toHaveLength(1);
    const copy = duplicateTemplate('a');
    expect(copy?.name).toBe('Follow Up（副本）');
    expect(loadTemplates()).toHaveLength(2);
    deleteTemplate('a');
    expect(loadTemplates()).toHaveLength(1);
    expect(loadTemplates()[0].name).toBe('Follow Up（副本）');
    expect(saved[0].category).toBe('商务');
  });

  it('resolves template variables', () => {
    const { resolved, unresolved } = substituteTemplateVariables(
      '{{contact.name}} <{{contact.email}}> 来自 {{account.email}}，日期 {{today}}，签名 {{signature}}',
      {
        contactName: 'Ada',
        contactEmail: 'ada@example.com',
        accountEmail: 'demo@better-email.local',
        signature: 'Best',
      },
    );
    expect(resolved).toContain('Ada');
    expect(resolved).toContain('ada@example.com');
    expect(resolved).toContain('demo@better-email.local');
    expect(resolved).toContain('Best');
    expect(resolved).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(unresolved).toEqual([]);
  });

  it('keeps unresolved placeholders and reports them', () => {
    const { resolved, unresolved } = substituteTemplateVariables(
      'Hi {{contact.name}} {{unknown.var}}',
      {},
    );
    expect(resolved).toContain('{{contact.name}}');
    expect(resolved).toContain('{{unknown.var}}');
    expect(unresolved).toEqual(['{{contact.name}}', '{{unknown.var}}']);
  });

  it('parses AI generated templates', () => {
    const parsed = parseAiGeneratedTemplate(
      '主题：产品介绍跟进\n\n正文：\n您好 {{contact.name}}，\n\n这是我们的产品介绍。\n\n祝好，\n{{account.email}}',
    );
    expect(parsed.subject).toBe('产品介绍跟进');
    expect(parsed.body).toContain('您好 {{contact.name}}');
    expect(parsed.body).toContain('{{account.email}}');
  });

  it('falls back to raw content when AI output lacks structure', () => {
    const parsed = parseAiGeneratedTemplate('plain text without markers');
    expect(parsed.subject).toBe('');
    expect(parsed.body).toBe('plain text without markers');
  });

  it('lists standard variables', () => {
    expect(TEMPLATE_VARIABLES.some((variable) => variable.name === '{{today}}')).toBe(true);
    expect(TEMPLATE_VARIABLES.some((variable) => variable.name === '{{signature}}')).toBe(true);
  });

  it('persists templates in the legacy storage key', () => {
    saveTemplate({
      id: 'b',
      name: 'X',
      subject: '',
      body: 'b',
      html_body: '',
      category: '',
      tags: [],
      account_id: 0,
      is_favorite: false,
      created_at: '',
      updated_at: '',
    });
    expect(window.localStorage.getItem('better-email.composeTemplates')).toContain('"name":"X"');
  });

  it('ignores invalid stored values', () => {
    persistTemplates([{ id: 'ok', name: 'OK', subject: '', body: 'yes', html_body: '', category: '', tags: [], account_id: 0, is_favorite: false, created_at: '', updated_at: '' }]);
    expect(loadTemplates()).toHaveLength(1);
    window.localStorage.setItem('better-email.composeTemplates', '{broken');
    expect(loadTemplates()).toEqual([]);
  });

  it('migrateLegacyTemplate returns null for garbage', () => {
    expect(migrateLegacyTemplate(null)).toBeNull();
    expect(migrateLegacyTemplate({ name: '' })).toBeNull();
  });
});

describe('parse chain debug', () => {
  it('parses the exact mock output', () => {
    const content = `主题：向新客户介绍产品跟进

正文：
您好 {{contact.name}}，

感谢您对 向新客户介绍产品 的关注。我们希望确认接下来的安排，如您有任何疑问，请随时回复。

祝好，
{{account.email}}`;
    const parsed = parseAiGeneratedTemplate(content);
    expect(parsed.subject).toBe('向新客户介绍产品跟进');
    expect(parsed.body).toContain('{{contact.name}}');
  });
});
