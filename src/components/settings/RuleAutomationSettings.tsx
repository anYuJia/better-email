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
} from '../../app/types';
import {
  SettingsBadge,
  SettingsButton,
  SettingsEmptyState,
  SettingsField,
  SettingsSection,
  SettingsSwitch,
} from './shared';

type RuleAutomationSettingsProps = {
  ruleForm: MailRuleInput;
  ruleBuilderField: RuleConditionField;
  ruleBuilderNeedle: string;
  editingRuleId: number | null;
  labels: Label[];
  rules: MailRule[];
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
    <SettingsSection
      title="处理规则"
      description="按发件人、主题、正文或收件人处理新邮件"
      badge={<SettingsBadge tone="neutral">{rules.length} 条规则</SettingsBadge>}
      dataSection="rules"
    >
      <div className="rule-editor settings-rule-editor">
        <SettingsField label="规则名称">
          <input
            value={ruleForm.name}
            onChange={(event) => onRuleFormChange({ ...ruleForm, name: event.target.value })}
            placeholder="规则名称"
          />
        </SettingsField>
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
          <SettingsSwitch
            label="启用规则"
            description="保存后立即参与新邮件处理"
            checked={ruleForm.enabled}
            onChange={(checked) => onRuleFormChange({ ...ruleForm, enabled: checked })}
          />
          <SettingsButton variant="primary" icon={<Plus size={14} />} onClick={onSaveRule}>
            {editingRuleId ? '更新规则' : '新增规则'}
          </SettingsButton>
        </div>
      </div>

      {rules.length === 0 ? (
        <SettingsEmptyState>还没有规则。创建一条规则，按条件自动处理新邮件。</SettingsEmptyState>
      ) : (
        <div className="settings-rule-list">
          {rules.map((rule) => (
            <div className="rule-item" key={rule.id}>
              <span>
                <strong>{rule.name}</strong>
                <small>{rule.condition} → {rule.action}</small>
              </span>
              <SettingsBadge tone={rule.enabled ? 'success' : 'neutral'}>
                {rule.enabled ? '启用' : '停用'}
              </SettingsBadge>
              <div className="st-actions">
                <SettingsButton size="sm" onClick={() => onToggleRule(rule)}>
                  {rule.enabled ? '停用' : '启用'}
                </SettingsButton>
                <SettingsButton size="sm" icon={<Pencil size={13} />} onClick={() => onEditRule(rule)}>
                  编辑
                </SettingsButton>
                <SettingsButton size="sm" variant="danger-secondary" icon={<Trash2 size={13} />} onClick={() => onRemoveRule(rule)}>
                  删除
                </SettingsButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
