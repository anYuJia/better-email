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
  saveTemplate,
} from '../../app/templateStore';
import { aiErrorMessage, generateTemplate } from '../../app/aiService';
import { loadAiServiceConfig } from '../../app/aiServiceConfig';
import type { AiRequestError } from '../../app/types/ai';
import {
  SettingsBadge,
  SettingsButton,
  SettingsEmptyState,
  SettingsField,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from './shared';

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

  const isEmptyList = templates.length === 0 && !query && !favoritesOnly;

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
    <SettingsSection
      title="模板管理"
      description="维护常用写信模板，支持变量与 AI 辅助生成。"
      badge={<SettingsBadge tone="neutral">{templates.length} 个模板</SettingsBadge>}
      dataSection="templates"
    >
      <div className="template-toolbar">
        <div className="template-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            placeholder="搜索模板名称、主题或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SettingsButton
          className={`template-filter-button${favoritesOnly ? ' active' : ''}`}
          aria-pressed={favoritesOnly}
          icon={<Star size={14} />}
          onClick={() => setFavoritesOnly((current) => !current)}
        >
          常用
        </SettingsButton>
        <SettingsButton icon={<Sparkles size={14} />} onClick={openAiGenerator}>
          AI 生成
        </SettingsButton>
        <SettingsButton variant="primary" icon={<Plus size={14} />} onClick={startCreate}>
          新建模板
        </SettingsButton>
      </div>

      {status && <div className="settings-inline-status">{status}</div>}

      <div className={`template-ai-generator${aiOpen ? '' : ' is-collapsed'}`}>
        <button
          type="button"
          className="template-ai-toggle"
          aria-label="AI 辅助生成模板"
          aria-expanded={aiOpen}
          onClick={() => setAiOpen((current) => !current)}
        >
          <Wand2 size={15} aria-hidden="true" />
          <strong>AI 辅助生成模板</strong>
          <small>描述用途后自动生成主题与正文，可编辑后保存。</small>
          <ChevronDown size={14} className="template-ai-chevron" aria-hidden="true" />
        </button>
        {aiOpen && (
          <div className="template-ai-body">
            {!aiEnabled && (
              <SettingsNotice tone="warning" title="提示：AI 服务尚未开启" action={
                onNavigateToAi ? (
                  <SettingsButton size="sm" onClick={onNavigateToAi}>前往 AI 服务设置</SettingsButton>
                ) : undefined
              }>
                <p>请先在「AI 服务」设置中配置并开启，才能使用模板生成。</p>
              </SettingsNotice>
            )}
            <div className="template-ai-row">
              <input
                className="settings-text-input"
                type="text"
                placeholder="描述模板用途，如：给新客户发送产品介绍与报价"
                value={aiPrompt}
                onChange={(event) => setAiPrompt(event.target.value)}
              />
              <SettingsButton
                variant="primary"
                disabled={aiBusy || !aiPrompt.trim()}
                icon={<Sparkles size={14} />}
                onClick={runAiGenerate}
              >
                {aiBusy ? '生成中…' : 'AI 生成'}
              </SettingsButton>
            </div>
            {aiPreview && (
              <div className="template-ai-preview">
                <SettingsField label="生成的主题">
                  <input
                    className="settings-text-input"
                    type="text"
                    value={aiPreview.subject}
                    onChange={(event) => setAiPreview({ ...aiPreview, subject: event.target.value })}
                  />
                </SettingsField>
                <SettingsField label="生成的正文">
                  <textarea
                    className="settings-textarea"
                    rows={6}
                    value={aiPreview.body}
                    onChange={(event) => setAiPreview({ ...aiPreview, body: event.target.value })}
                  />
                </SettingsField>
                <div className="st-actions">
                  <SettingsButton onClick={() => setAiPreview(null)}>放弃</SettingsButton>
                  <SettingsButton variant="primary" icon={<Pencil size={14} />} onClick={saveAiPreview}>
                    保存为模板
                  </SettingsButton>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="template-editor">
          <div className="template-editor-header">
            <h3>{editor.id ? '编辑模板' : '新建模板'}</h3>
            <SettingsButton size="sm" icon={<Sparkles size={13} />} onClick={openAiGenerator}>
              用 AI 生成
            </SettingsButton>
          </div>
          <SettingsField label="名称">
            <input
              className="settings-text-input"
              type="text"
              aria-label="模板名称"
              placeholder="模板名称"
              value={editor.name}
              onChange={(event) => setEditor({ ...editor, name: event.target.value })}
            />
          </SettingsField>
          <SettingsField label="邮件主题">
            <input
              className="settings-text-input"
              type="text"
              aria-label="邮件主题"
              placeholder="邮件主题（可插入 {{contact.name}} 等变量）"
              value={editor.subject}
              onFocus={() => setActiveVariableField('subject')}
              onChange={(event) => setEditor({ ...editor, subject: event.target.value })}
            />
          </SettingsField>
          <SettingsField label="正文">
            <textarea
              className="settings-textarea"
              rows={7}
              aria-label="正文"
              placeholder="邮件正文（可插入 {{today}}、{{contact.name}} 等变量）"
              value={editor.body}
              onFocus={() => setActiveVariableField('body')}
              onChange={(event) => setEditor({ ...editor, body: event.target.value })}
            />
          </SettingsField>
          <SettingsField label="分类">
            <input
              className="settings-text-input"
              type="text"
              aria-label="分类"
              placeholder="如：商务 / 跟进 / 感谢（留空为未分类）"
              value={editor.category}
              onChange={(event) => setEditor({ ...editor, category: event.target.value })}
            />
          </SettingsField>
          <SettingsField label="标签（逗号分隔）">
            <input
              className="settings-text-input"
              type="text"
              aria-label="标签"
              placeholder="如：销售, 客户"
              value={editor.tags}
              onChange={(event) => setEditor({ ...editor, tags: event.target.value })}
            />
          </SettingsField>
          <SettingsField label="适用账号">
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
          </SettingsField>
          <SettingsSwitch
            label="设为常用模板"
            description="在写信时优先展示，并可通过「常用」筛选快速查找。"
            checked={editor.is_favorite}
            onChange={(checked) => setEditor({ ...editor, is_favorite: checked })}
          />

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

          <div className="st-actions">
            <SettingsButton onClick={() => setEditing(false)}>取消</SettingsButton>
            <SettingsButton variant="primary" icon={<Pencil size={14} />} onClick={saveEditor}>
              保存模板
            </SettingsButton>
          </div>
        </div>
      )}

      {isEmptyList ? (
        <SettingsEmptyState
          actions={
            <div className="st-actions">
              <SettingsButton variant="primary" icon={<Plus size={14} />} onClick={startCreate}>
                新建模板
              </SettingsButton>
              <SettingsButton icon={<Sparkles size={14} />} onClick={openAiGenerator}>
                AI 生成
              </SettingsButton>
            </div>
          }
        >
          <span className="template-empty-icon" aria-hidden="true"><FileText size={20} /></span>
          <strong>暂无模板</strong>
          <small>新建一个模板，或使用 AI 辅助生成。</small>
        </SettingsEmptyState>
      ) : (
        <div className="template-list">
          {filtered.length === 0 && (
            <p className="settings-empty-hint">没有符合条件的模板。</p>
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
                <SettingsButton size="sm" variant="ghost" title="编辑" aria-label={`编辑 ${template.name}`} icon={<Pencil size={14} />} onClick={() => startEdit(template)} />
                <SettingsButton size="sm" variant="ghost" title="复制" aria-label={`复制 ${template.name}`} icon={<Copy size={14} />} onClick={() => duplicate(template)} />
                <SettingsButton
                  size="sm"
                  variant="danger-secondary"
                  title="删除"
                  aria-label={`删除 ${template.name}`}
                  icon={<Trash2 size={14} />}
                  onClick={() => setConfirmDeleteId(template.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmDeleteId && (
        <div className="settings-cache-confirm-backdrop">
          <div className="settings-cache-confirm" role="dialog" aria-modal="true">
            <strong>删除模板</strong>
            <p>确定删除该模板吗？此操作不可恢复。</p>
            <div className="st-actions">
              <SettingsButton onClick={() => setConfirmDeleteId(null)}>取消</SettingsButton>
              <SettingsButton variant="danger" onClick={removeTemplate}>确认</SettingsButton>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
