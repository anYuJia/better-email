import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  ruleActionParts,
  ruleActionPresets,
  ruleConditionFields,
  type RuleConditionField,
} from '../../app/appConfig';
import type {
  Label,
  MailRule,
  MailRuleInput,
  ThreadSummary,
} from '../../app/types';
import './automation-settings.css';

type RuleAutomationSettingsProps = {
  ruleForm: MailRuleInput;
  ruleBuilderField: RuleConditionField;
  ruleBuilderNeedle: string;
  editingRuleId: number | null;
  labels: Label[];
  rules: MailRule[];
  threads: ThreadSummary[];
  onRuleFormChange: (rule: MailRuleInput) => void;
  onRuleConditionFieldChange: (field: RuleConditionField) => void;
  onRuleConditionValueChange: (value: string) => void;
  onRuleLabelActionChange: (label: string) => void;
  onToggleRuleAction: (action: string) => void;
  onSaveRule: () => void;
  onToggleRule: (rule: MailRule) => void;
  onEditRule: (rule: MailRule) => void;
  onRemoveRule: (rule: MailRule) => void;
};

export default function RuleAutomationSettings({
  ruleForm,
  ruleBuilderField,
  ruleBuilderNeedle,
  editingRuleId,
  labels,
  rules,
  threads,
  onRuleFormChange,
  onRuleConditionFieldChange,
  onRuleConditionValueChange,
  onRuleLabelActionChange,
  onToggleRuleAction,
  onSaveRule,
  onToggleRule,
  onEditRule,
  onRemoveRule,
}: RuleAutomationSettingsProps) {
  return (
    <section className="tool-panel settings-rule-panel" data-settings-section="rules">
      <header className="tool-header">
        <span>
          <strong>处理规则</strong>
          <small>按发件人、主题、正文或收件人处理新邮件</small>
        </span>
        <em>{rules.length} 条规则</em>
      </header>

      <div className="rule-editor settings-rule-editor">
        <input
          value={ruleForm.name}
          onChange={(event) => onRuleFormChange({ ...ruleForm, name: event.target.value })}
          placeholder="规则名称"
        />
        <div className="rule-builder">
          <label>
            <span>如果</span>
            <select
              value={ruleBuilderField}
              onChange={(event) => onRuleConditionFieldChange(event.target.value as RuleConditionField)}
            >
              {ruleConditionFields.map((field) => (
                <option key={field.id} value={field.id}>{field.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>包含</span>
            <input
              value={ruleBuilderNeedle}
              onChange={(event) => onRuleConditionValueChange(event.target.value)}
              placeholder="关键词或邮箱"
            />
          </label>
          <label>
            <span>打标签</span>
            <select
              value={
                ruleActionParts(ruleForm.action)
                  .find((part) => part.toLowerCase().startsWith('apply label '))
                  ?.slice('apply label '.length) ?? ''
              }
              onChange={(event) => onRuleLabelActionChange(event.target.value)}
            >
              <option value="">不打标签</option>
              {labels.map((label) => (
                <option key={label.id} value={label.name}>{label.name}</option>
              ))}
            </select>
          </label>
          <div className="rule-action-chips">
            {ruleActionPresets.map((item) => (
              <button
                type="button"
                key={item.id}
                className={ruleActionParts(ruleForm.action).some((part) => part.toLowerCase() === item.id)
                  ? 'active'
                  : ''}
                onClick={() => onToggleRuleAction(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <details className="rule-advanced">
          <summary>规则语法</summary>
          <small>可手动组合多个动作，用分号分隔。</small>
          <input
            value={ruleForm.condition}
            onChange={(event) => onRuleFormChange({ ...ruleForm, condition: event.target.value })}
            placeholder="条件，如 from contains customer"
            aria-label="规则条件语法"
          />
          <input
            value={ruleForm.action}
            onChange={(event) => onRuleFormChange({ ...ruleForm, action: event.target.value })}
            placeholder="动作，如 apply label 重要客户; mark read; star; stop processing"
            aria-label="规则动作语法"
          />
        </details>
        <div className="settings-rule-footer">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={ruleForm.enabled}
              onChange={(event) => onRuleFormChange({ ...ruleForm, enabled: event.target.checked })}
            />
            <span>
              <strong>启用规则</strong>
              <small>保存后立即参与新邮件处理</small>
            </span>
          </label>
          <button type="button" onClick={onSaveRule}>
            <Plus size={14} />
            {editingRuleId ? '更新规则' : '新增规则'}
          </button>
        </div>
      </div>

      <div className="settings-rule-list">
        {rules.map((rule) => (
          <div className="rule-item" key={rule.id}>
            <span>
              <strong>{rule.name}</strong>
              <small>{rule.condition} → {rule.action}</small>
            </span>
            <em className={rule.enabled ? 'active' : ''}>{rule.enabled ? '启用' : '停用'}</em>
            <div>
              <button type="button" onClick={() => onToggleRule(rule)}>{rule.enabled ? '停用' : '启用'}</button>
              <button type="button" onClick={() => onEditRule(rule)}>
                <Pencil size={13} />
                编辑
              </button>
              <button type="button" className="danger" onClick={() => onRemoveRule(rule)}>
                <Trash2 size={13} />
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="settings-thread-summary">
        <strong>最近会话</strong>
        <div>
          {threads.slice(0, 6).map((thread) => (
            <p key={thread.thread_key}>
              <span>{thread.subject}</span>
              <small>{thread.message_count} 封 · 未读 {thread.unread_count}</small>
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
