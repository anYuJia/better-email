import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Copy,
  FileText,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Wand2,
} from 'lucide-react';
import type { ComposeTemplate } from '../../app/types/composer';
import type { Account } from '../../app/types/account';
import { invoke } from '../../tauriBridge';
import {
  TEMPLATE_VARIABLES,
  deleteTemplate,
  duplicateTemplate,
  loadTemplates,
  parseAiGeneratedTemplate,
  persistTemplates,
  saveTemplate,
} from '../../app/templateStore';
import { aiErrorMessage, generateTemplate } from '../../app/aiService';
import { loadAiServiceConfig } from '../../app/aiServiceConfig';
import type { AiRequestError } from '../../app/types/ai';
import './ai-settings.css';

type TemplateEditor = {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  tags: string;
  account_id: number;
  is_favorite: boolean;
};

type TemplateSettingsProps = {
  onNavigateToAi?: () => void;
};

const emptyEditor: TemplateEditor = {
  id: '',
  name: '',
  subject: '',
  body: '',
  category: '',
  tags: '',
  account_id: 0,
  is_favorite: false,
};

const PREVIEW_SAMPLES: Record<string, string> = {
  '{{contact.name}}': '示例联系人',
  '{{contact.email}}': 'contact@example.com',
  '{{account.email}}': 'me@example.com',
  '{{signature}}': '（此处插入你的签名）',
};

function renderTemplatePreview(text: string): string {
  let rendered = text;
  for (const [variable, sample] of Object.entries(PREVIEW_SAMPLES)) {
    rendered = rendered.split(variable).join(sample);
  }
  return rendered.split('{{today}}').join(new Date().toISOString().slice(0, 10));
}

function editorFromTemplate(template: ComposeTemplate): TemplateEditor {
  return {
    id: template.id,
    name: template.name,
    subject: template.subject,
    body: template.body,
    category: template.category,
    tags: template.tags.join(', '),
    account_id: template.account_id,
    is_favorite: template.is_favorite,
  };
}

export default function TemplateSettings({ onNavigateToAi }: TemplateSettingsProps) {
  const [templates, setTemplates] = useState<ComposeTemplate[]>(() => loadTemplates());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editor, setEditor] = useState<TemplateEditor>(emptyEditor);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ subject: string; body: string } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [activeVariableField, setActiveVariableField] = useState<'subject' | 'body'>('body');
  const [aiEnabled] = useState(() => loadAiServiceConfig().enabled);

  useEffect(() => {
    void invoke<Account[]>('list_accounts').then(setAccounts).catch(() => undefined);
  }, []);

  const categories = useMemo(() => (
    [...new Set(templates.map((template) => template.category).filter(Boolean))]
  ), [templates]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const candidates = favoritesOnly
      ? templates.filter((template) => template.is_favorite)
      : templates;
    if (!term) return candidates;
    return candidates.filter((template) => (
      [template.name, template.subject, template.category, template.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(term)
    ));
  }, [templates, query, favoritesOnly]);

  function refresh(next: ComposeTemplate[]) {
    setTemplates(next);
    setStatus('');
  }

  function startCreate() {
    setEditor(emptyEditor);
    setEditing(true);
    setStatus('');
  }

  function startEdit(template: ComposeTemplate) {
    setEditor(editorFromTemplate(template));
    setEditing(true);
    setStatus('');
  }

  function saveEditor() {
    if (!editor.name.trim()) {
      setStatus('请填写模板名称');
      return;
    }
    const existing = editor.id ? loadTemplates().find((template) => template.id === editor.id) : null;
    const next = saveTemplate({
      id: editor.id || crypto.randomUUID(),
      name: editor.name,
      subject: editor.subject,
      body: editor.body,
      html_body: existing?.html_body ?? '',
      category: editor.category.trim(),
      tags: editor.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      account_id: editor.account_id,
      is_favorite: editor.is_favorite,
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    refresh(next);
    setEditing(false);
    setEditor(emptyEditor);
    setStatus(`模板已保存：${editor.name}`);
  }

  function duplicate(template: ComposeTemplate) {
    const copy = duplicateTemplate(template.id);
    if (copy) {
      refresh(loadTemplates());
      setStatus(`已复制模板：${copy.name}`);
    }
  }

  function removeTemplate() {
    if (!confirmDeleteId) return;
    const target = templates.find((template) => template.id === confirmDeleteId);
    refresh(deleteTemplate(confirmDeleteId));
    setConfirmDeleteId(null);
    if (target) setStatus(`模板已删除：${target.name}`);
  }

  function openAiGenerator() {
    setAiOpen(true);
  }

  async function runAiGenerate() {
    setAiBusy(true);
    setAiPreview(null);
    try {
      const result = await generateTemplate(aiPrompt);
      setAiPreview(parseAiGeneratedTemplate(result.content));
      setStatus('AI 已生成模板，请确认后保存');
    } catch (error) {
      setStatus(aiErrorMessage(error as AiRequestError));
    } finally {
      setAiBusy(false);
    }
  }

  function saveAiPreview() {
    if (!aiPreview) return;
    const next = saveTemplate({
      id: crypto.randomUUID(),
      name: editor.name.trim() || (aiPrompt.trim() ? `${aiPrompt.trim().slice(0, 20)}模板` : 'AI 生成模板'),
      subject: aiPreview.subject,
      body: aiPreview.body,
      html_body: '',
      category: editor.category.trim(),
      tags: editor.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      account_id: editor.account_id,
      is_favorite: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    refresh(next);
    setAiPreview(null);
    setAiPrompt('');
    setStatus('AI 生成的模板已保存');
  }

  function insertVariable(variableName: string) {
    setEditor((current) => ({
      ...current,
      [activeVariableField]: `${current[activeVariableField]}${current[activeVariableField] ? ' ' : ''}${variableName}`,
    }));
  }

  return (
    <section className="tool-panel settings-template-panel" data-settings-section="templates">
      <header className="tool-header template-page-header">
        <span>
          <strong>模板管理</strong>
          <small>维护常用写信模板，支持变量与 AI 辅助生成。</small>
        </span>
        <em>{templates.length} 个模板</em>
      </header>

      <div className="template-toolbar">
        <div className="template-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="搜索模板名称、主题或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={`template-filter-button${favoritesOnly ? ' active' : ''}`}
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((current) => !current)}
        >
          <Star size={14} /> 常用
        </button>
        <button type="button" className="secondary-action" onClick={openAiGenerator}>
          <Sparkles size={14} /> AI 生成
        </button>
        <button type="button" className="secondary-action" onClick={startCreate}>
          <Plus size={14} /> 新建模板
        </button>
      </div>

      {status && <div className="settings-inline-status">{status}</div>}

      <div className={`template-ai-generator settings-ai-panel${aiOpen ? '' : ' is-collapsed'}`}>
        <button
          type="button"
          className="template-ai-toggle"
          aria-label="AI 辅助生成模板"
          aria-expanded={aiOpen}
          onClick={() => setAiOpen((current) => !current)}
        >
          <Wand2 size={15} />
          <strong>AI 辅助生成模板</strong>
          <small>描述用途后自动生成主题与正文，可编辑后保存。</small>
          <ChevronDown size={14} className="template-ai-chevron" />
        </button>
        {aiOpen && (
          <div className="template-ai-body">
            {!aiEnabled && (
              <div className="template-ai-disabled-hint">
                提示：AI 服务尚未开启。请先在「AI 服务」设置中配置并开启，才能使用模板生成。
                {onNavigateToAi && (
                  <button type="button" onClick={onNavigateToAi}>前往 AI 服务设置</button>
                )}
              </div>
            )}
            <div className="template-ai-row">
              <input
                className="settings-text-input"
                type="text"
                placeholder="描述模板用途，如：给新客户发送产品介绍与报价"
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
              />
              <button type="button" className="secondary-action" onClick={runAiGenerate} disabled={aiBusy || !aiPrompt.trim()}>
                <Sparkles size={14} /> {aiBusy ? '生成中…' : 'AI 生成'}
              </button>
            </div>
            {aiPreview && (
              <div className="template-ai-preview">
                <div className="settings-field">
                  <span className="settings-field-label">生成的主题</span>
                  <input
                    className="settings-text-input"
                    type="text"
                    value={aiPreview.subject}
                    onChange={(event) => setAiPreview({ ...aiPreview, subject: event.target.value })}
                  />
                </div>
                <div className="settings-field">
                  <span className="settings-field-label">生成的正文</span>
                  <textarea
                    className="settings-textarea"
                    rows={6}
                    value={aiPreview.body}
                    onChange={(event) => setAiPreview({ ...aiPreview, body: event.target.value })}
                  />
                </div>
                <div className="template-editor-actions">
                  <button type="button" className="secondary-action" onClick={() => setAiPreview(null)}>
                    放弃
                  </button>
                  <button type="button" className="primary-action" onClick={saveAiPreview}>
                    <Pencil size={14} /> 保存为模板
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="template-editor settings-ai-panel">
          <div className="template-editor-header">
            <h3>{editor.id ? '编辑模板' : '新建模板'}</h3>
            <button type="button" className="template-editor-ai-entry" onClick={openAiGenerator}>
              <Sparkles size={13} /> 用 AI 生成
            </button>
          </div>
          <div className="settings-field">
            <span className="settings-field-label">名称</span>
            <input
              className="settings-text-input"
              type="text"
              aria-label="模板名称"
              placeholder="模板名称"
              value={editor.name}
              onChange={(event) => setEditor({ ...editor, name: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">邮件主题</span>
            <input
              className="settings-text-input"
              type="text"
              aria-label="邮件主题"
              placeholder="邮件主题（可插入 {{contact.name}} 等变量）"
              value={editor.subject}
              onFocus={() => setActiveVariableField('subject')}
              onChange={(event) => setEditor({ ...editor, subject: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">正文</span>
            <textarea
              className="settings-textarea"
              rows={7}
              aria-label="正文"
              placeholder="邮件正文（可插入 {{today}}、{{contact.name}} 等变量）"
              value={editor.body}
              onFocus={() => setActiveVariableField('body')}
              onChange={(event) => setEditor({ ...editor, body: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">分类</span>
            <input
              className="settings-text-input"
              type="text"
              aria-label="分类"
              placeholder="如：商务 / 跟进 / 感谢（留空为未分类）"
              value={editor.category}
              onChange={(event) => setEditor({ ...editor, category: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">标签（逗号分隔）</span>
            <input
              className="settings-text-input"
              type="text"
              aria-label="标签"
              placeholder="如：销售, 客户"
              value={editor.tags}
              onChange={(event) => setEditor({ ...editor, tags: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">适用账号</span>
            <select
              className="settings-text-input"
              aria-label="适用账号"
              value={editor.account_id}
              onChange={(event) => setEditor({ ...editor, account_id: Number(event.target.value) || 0 })}
            >
              <option value={0}>全局（所有账号）</option>
              {accounts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  仅 {entry.display_name || entry.email}（{entry.email}）
                </option>
              ))}
            </select>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={editor.is_favorite}
              onChange={(event) => setEditor({ ...editor, is_favorite: event.target.checked })}
            />
            <span>
              <strong>设为常用模板</strong>
              <small>在写信时优先展示，并可通过「常用」筛选快速查找。</small>
            </span>
          </label>

          <div className="template-variable-hints">
            <strong>变量（点击插入到{activeVariableField === 'subject' ? '主题' : '正文'}）</strong>
            {TEMPLATE_VARIABLES.map((variable) => (
              <button
                type="button"
                key={variable.name}
                className="template-variable-chip"
                title={variable.description}
                onClick={() => insertVariable(variable.name)}
              >
                <code>{variable.name}</code>
                <small>{variable.label}</small>
              </button>
            ))}
            <small>无法解析的变量会保留原样，不会静默删除。</small>
          </div>

          {(editor.subject.trim() || editor.body.trim()) && (
            <div className="template-preview">
              <strong>预览（使用示例联系人）</strong>
              {editor.subject.trim() && (
                <p className="template-preview-subject">{renderTemplatePreview(editor.subject)}</p>
              )}
              {editor.body.trim() && (
                <pre className="template-preview-body">{renderTemplatePreview(editor.body)}</pre>
              )}
              <small>实际发送时按真实联系人、日期与签名渲染。</small>
            </div>
          )}

          <div className="template-editor-actions">
            <button type="button" className="secondary-action" onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="button" className="primary-action" onClick={saveEditor}>
              <Pencil size={14} /> 保存模板
            </button>
          </div>
        </div>
      )}

      <div className="template-list">
        {filtered.length === 0 && (
          <p className="settings-empty-hint">
            {query || favoritesOnly
              ? '没有符合条件的模板。'
              : '暂无模板。新建一个模板，或使用 AI 辅助生成。'}
          </p>
        )}
        {filtered.map((template) => (
          <div className="template-row" key={template.id}>
            <div className="template-row-main">
              <strong>
                {template.is_favorite && <Star size={13} className="template-favorite" />}
                {template.name}
              </strong>
              <small>{template.subject || '（无主题）'}</small>
              {template.category && <em className="template-category">{template.category}</em>}
              {template.tags.map((tag) => <em key={tag} className="template-tag">{tag}</em>)}
              <span className="template-updated">更新于 {new Date(template.updated_at).toLocaleDateString()}</span>
            </div>
            <div className="template-row-actions">
              <button type="button" title="编辑" aria-label={`编辑 ${template.name}`} onClick={() => startEdit(template)}>
                <Pencil size={14} />
              </button>
              <button type="button" title="复制" aria-label={`复制 ${template.name}`} onClick={() => duplicate(template)}>
                <Copy size={14} />
              </button>
              <button
                type="button"
                className="danger-action"
                title="删除"
                aria-label={`删除 ${template.name}`}
                onClick={() => setConfirmDeleteId(template.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDeleteId && (
        <div className="settings-cache-confirm-backdrop">
          <div className="settings-cache-confirm" role="dialog" aria-modal="true">
            <strong>删除模板</strong>
            <p>确定删除该模板吗？此操作不可恢复。</p>
            <div>
              <button type="button" onClick={() => setConfirmDeleteId(null)}>取消</button>
              <button type="button" className="danger-action" onClick={removeTemplate}>确认</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
