import { useState } from 'react';
import { LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
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
  AnimatedDisclosure,
  SettingsBadge,
  SettingsButton,
  SettingsEmptyState,
  SettingsField,
  SettingsSection,
  SettingsSwitch,
} from './shared';
import { CustomSelect } from './accounts/CustomSelect';

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
  onSaveRule: () => Promise<void>;
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
  const [saveIssue, setSaveIssue] = useState<{ field: 'name' | 'condition' | 'action' | 'save'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function clearSaveIssue() {
    if (saveIssue) setSaveIssue(null);
  }

  function validateRule() {
    if (!ruleForm.name.trim()) {
      return { field: 'name' as const, message: '请填写规则名称。' };
    }
    const condition = ruleForm.condition.trim();
    if (!condition || /\bcontains$/i.test(condition)) {
      return { field: 'condition' as const, message: '请填写要匹配的关键词、邮箱或地址。' };
    }
    const actions = ruleActionParts(ruleForm.action);
    if (actions.length === 0 || actions.every((action) => action.toLowerCase() === 'apply label')) {
      return { field: 'action' as const, message: '请至少选择一个处理操作，或指定要添加的标签。' };
    }
    return null;
  }

  async function handleSaveRule() {
    const issue = validateRule();
    if (issue) {
      setSaveIssue(issue);
      return;
    }
    setSaveIssue(null);
    setSaving(true);
    try {
      await onSaveRule();
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error:\s*/i, '') : String(error);
      setSaveIssue({ field: 'save', message: message || '无法保存规则，请稍后重试。' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title="处理规则"
      description="按发件人、主题、正文或收件人处理新邮件"
      badge={<SettingsBadge tone="neutral">{rules.length} 条规则</SettingsBadge>}
      dataSection="rules"
    >
      <div className="settings-rule-editor">
        <header className="settings-rule-editor-header">
          <span>
            <strong>{editingRuleId ? '编辑规则' : '新建规则'}</strong>
            <small>先设置匹配条件，再选择邮件到达后的处理方式。</small>
          </span>
        </header>
        <SettingsField label="规则名称" error={saveIssue?.field === 'name' ? saveIssue.message : undefined}>
          <input
            value={ruleForm.name}
            aria-invalid={saveIssue?.field === 'name'}
            onChange={(event) => {
              clearSaveIssue();
              onRuleFormChange({ ...ruleForm, name: event.target.value });
            }}
            placeholder="规则名称"
          />
        </SettingsField>
        <div className="settings-rule-builder">
          <section className="settings-rule-builder-group">
            <strong>匹配条件</strong>
            <div className="settings-rule-condition-fields">
              <div className="settings-rule-select-field">
                <span>字段</span>
                <CustomSelect
                  ariaLabel="规则条件字段"
                  value={ruleBuilderField}
                  options={ruleConditionFields.map((field) => ({
                    value: field.id,
                    label: field.label,
                  }))}
                  onChange={(nextField) => onRuleConditionFieldChange(nextField as RuleConditionField)}
                />
              </div>
              <label>
                <span>包含</span>
                <input
                  value={ruleBuilderNeedle}
                  aria-invalid={saveIssue?.field === 'condition'}
                  onChange={(event) => {
                    clearSaveIssue();
                    onRuleConditionValueChange(event.target.value);
                  }}
                  placeholder="关键词或邮箱"
                />
                {saveIssue?.field === 'condition' && <small className="st-field-error">{saveIssue.message}</small>}
              </label>
            </div>
          </section>
          <section className="settings-rule-builder-group">
            <strong>处理操作</strong>
            <div className="settings-rule-label-action">
              <span>打标签</span>
              <CustomSelect
                ariaLabel="规则标签动作"
                value={
                  ruleActionParts(ruleForm.action)
                    .find((part) => part.toLowerCase().startsWith('apply label '))
                    ?.slice('apply label '.length) ?? ''
                }
                options={[
                  { value: '', label: '不打标签' },
                  ...labels.map((label) => ({ value: label.name, label: label.name })),
                ]}
                onChange={(labelName) => {
                  clearSaveIssue();
                  onRuleLabelActionChange(labelName);
                }}
              />
            </div>
            <div className="settings-rule-action-row">
              <span>附加操作</span>
              <div className="settings-rule-action-chips">
                {ruleActionPresets.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={ruleActionParts(ruleForm.action).some((part) => part.toLowerCase() === item.id)
                      ? 'active'
                      : ''}
                    onClick={() => {
                      clearSaveIssue();
                      onToggleRuleAction(item.id);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {saveIssue?.field === 'action' && <small className="st-field-error">{saveIssue.message}</small>}
            </div>
          </section>
        </div>
        <AnimatedDisclosure className="settings-rule-advanced" summary="规则语法">
          <small>可手动组合多个动作，用分号分隔。</small>
          <input
            value={ruleForm.condition}
            onChange={(event) => {
              clearSaveIssue();
              onRuleFormChange({ ...ruleForm, condition: event.target.value });
            }}
            placeholder="条件，如 from contains customer"
            aria-label="规则条件语法"
          />
          <input
            value={ruleForm.action}
            onChange={(event) => {
              clearSaveIssue();
              onRuleFormChange({ ...ruleForm, action: event.target.value });
            }}
            placeholder="动作，如 apply label 重要客户; mark read; star; stop processing"
            aria-label="规则动作语法"
          />
        </AnimatedDisclosure>
        {saveIssue?.field === 'save' && (
          <p className="settings-rule-save-error" role="alert">无法保存规则：{saveIssue.message}</p>
        )}
        <div className="settings-rule-footer">
          <SettingsSwitch
            label="启用规则"
            description="保存后立即参与新邮件处理"
            checked={ruleForm.enabled}
            onChange={(checked) => onRuleFormChange({ ...ruleForm, enabled: checked })}
          />
          <SettingsButton
            variant="primary"
            icon={saving ? <LoaderCircle className="spinning" size={14} /> : <Plus size={14} />}
            disabled={saving}
            onClick={() => { void handleSaveRule(); }}
          >
            {saving ? '保存中…' : editingRuleId ? '更新规则' : '新增规则'}
          </SettingsButton>
        </div>
      </div>

      {rules.length === 0 ? (
        <SettingsEmptyState>还没有规则。创建一条规则，按条件自动处理新邮件。</SettingsEmptyState>
      ) : (
        <div className="settings-rule-list">
          {rules.map((rule) => (
            <div className="settings-rule-item" key={rule.id}>
              <span>
                <strong>{rule.name}</strong>
                <small>{rule.condition} → {rule.action}</small>
              </span>
              <div className="settings-rule-item-actions">
                <SettingsSwitch
                  label=""
                  ariaLabel={`${rule.enabled ? '停用' : '启用'}规则：${rule.name}`}
                  checked={rule.enabled}
                  onChange={() => onToggleRule(rule)}
                />
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
