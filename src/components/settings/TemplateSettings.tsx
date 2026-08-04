import { useMemo, useState } from 'react';
import {
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

export default function TemplateSettings() {
  const [templates, setTemplates] = useState<ComposeTemplate[]>(() => loadTemplates());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<TemplateEditor>(emptyEditor);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ subject: string; body: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useState(() => {
    void invoke<Account[]>('list_accounts').then(setAccounts).catch(() => undefined);
  });

  const categories = useMemo(() => (
    [...new Set(templates.map((template) => template.category).filter(Boolean))]
  ), [templates]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return templates;
    return templates.filter((template) => (
      [template.name, template.subject, template.category, template.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(term)
    ));
  }, [templates, query]);

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

  return (
    <section className="tool-panel settings-template-panel" data-settings-section="templates">
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
        <button type="button" className="secondary-action" onClick={startCreate}>
          <Plus size={14} /> 新建模板
        </button>
      </div>

      {status && <div className="settings-inline-status">{status}</div>}

      {editing && (
        <div className="template-editor settings-ai-panel">
          <h3>{editor.id ? '编辑模板' : '新建模板'}</h3>
          <div className="settings-field">
            <span className="settings-field-label">名称</span>
            <input
              className="settings-text-input"
              type="text"
              placeholder="模板名称"
              value={editor.name}
              onChange={(event) => setEditor({ ...editor, name: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">主题</span>
            <input
              className="settings-text-input"
              type="text"
              placeholder="邮件主题（支持 {{contact.name}} 等变量）"
              value={editor.subject}
              onChange={(event) => setEditor({ ...editor, subject: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">正文</span>
            <textarea
              className="settings-textarea"
              rows={6}
              placeholder="邮件正文（支持 {{contact.name}}、{{today}} 等变量）"
              value={editor.body}
              onChange={(event) => setEditor({ ...editor, body: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">分类</span>
            <input
              className="settings-text-input"
              type="text"
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
              placeholder="如：销售, 客户"
              value={editor.tags}
              onChange={(event) => setEditor({ ...editor, tags: event.target.value })}
            />
          </div>
          <div className="settings-field">
            <span className="settings-field-label">适用账号</span>
            <select
              className="settings-text-input"
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
            设为常用模板
          </label>

          <div className="template-variable-hints">
            <strong>可用变量</strong>
            {TEMPLATE_VARIABLES.map((variable) => (
              <code key={variable.name}>{variable.name}</code>
            ))}
            <small>无法解析的变量会在插入时保留占位，不会静默插空。</small>
          </div>

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

      <div className="settings-ai-panel template-ai-generator">
        <h3><Wand2 size={15} /> AI 辅助生成模板</h3>
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

      <div className="template-list">
        {filtered.length === 0 && (
          <p className="settings-empty-hint">暂无模板。新建模板或使用 AI 生成。</p>
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
              <button type="button" title="编辑" aria-label="编辑" onClick={() => startEdit(template)}>
                <Pencil size={14} />
              </button>
              <button type="button" title="复制" aria-label="复制" onClick={() => duplicate(template)}>
                <Copy size={14} />
              </button>
              <button
                type="button"
                className="danger-action"
                title="删除"
                aria-label="删除"
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
