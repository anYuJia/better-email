import { useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildRuleCondition,
  emptyRuleForm,
  parseRuleCondition,
  ruleActionParts,
  setRuleActionPart,
} from '../app/appConfig';
import type { MailRule, MailRuleInput } from '../app/types';
import type { RuleConditionField } from '../app/appConfig';
import { invoke } from '../tauriBridge';

type RuleManagementOptions = {
  rules: MailRule[];
  setRules: Dispatch<SetStateAction<MailRule[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useRuleManagement({
  rules,
  setRules,
  setStatus,
}: RuleManagementOptions) {
  const [ruleForm, setRuleForm] = useState<MailRuleInput>(emptyRuleForm);
  const [ruleBuilderField, setRuleBuilderField] = useState<RuleConditionField>('from');
  const [ruleBuilderNeedle, setRuleBuilderNeedle] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<MailRule | null>(null);

  async function saveRule() {
    if (!ruleForm.name.trim() || !ruleForm.condition.trim() || !ruleForm.action.trim()) {
      setStatus('请填写规则名称、条件和动作');
      return;
    }
    const saved = await invoke<MailRule>('upsert_rule', {
      ruleId: editingRuleId,
      input: ruleForm,
    });
    setRules((current) => {
      const exists = current.some((rule) => rule.id === saved.id);
      return exists ? current.map((rule) => (rule.id === saved.id ? saved : rule)) : [...current, saved];
    });
    setRuleForm(emptyRuleForm);
    setEditingRuleId(null);
    setStatus(`规则已保存：${saved.name}`);
  }

  async function toggleRule(rule: MailRule) {
    const updated = await invoke<MailRule>('set_rule_enabled', {
      ruleId: rule.id,
      enabled: !rule.enabled,
    });
    setRules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setStatus(updated.enabled ? `规则已启用：${updated.name}` : `规则已停用：${updated.name}`);
  }

  function editRule(rule: MailRule) {
    const parsed = parseRuleCondition(rule.condition);
    setEditingRuleId(rule.id);
    setRuleBuilderField(parsed.field);
    setRuleBuilderNeedle(parsed.value);
    setRuleForm({
      name: rule.name,
      condition: rule.condition,
      action: rule.action,
      enabled: rule.enabled,
    });
    setStatus(`正在编辑规则：${rule.name}`);
  }

  async function removeRuleConfirmed(rule: MailRule) {
    await invoke('delete_rule', { ruleId: rule.id });
    setRules((current) => current.filter((item) => item.id !== rule.id));
    if (editingRuleId === rule.id) {
      setEditingRuleId(null);
      setRuleForm(emptyRuleForm);
      setRuleBuilderField('from');
      setRuleBuilderNeedle('');
    }
    setStatus(`规则已删除：${rule.name}`);
  }

  function removeRule(rule: MailRule) {
    setConfirmDeleteRule(rule);
  }

  function updateRuleConditionField(field: RuleConditionField) {
    setRuleBuilderField(field);
    setRuleForm((current) => ({ ...current, condition: buildRuleCondition(field, ruleBuilderNeedle) }));
  }

  function updateRuleConditionValue(value: string) {
    setRuleBuilderNeedle(value);
    setRuleForm((current) => ({ ...current, condition: buildRuleCondition(ruleBuilderField, value) }));
  }

  function toggleRuleAction(action: string) {
    const normalizedAction = action.toLowerCase();
    setRuleForm((current) => {
      const parts = ruleActionParts(current.action);
      const exists = parts.some((part) => part.toLowerCase() === normalizedAction);
      return {
        ...current,
        action: (exists
          ? parts.filter((part) => part.toLowerCase() !== normalizedAction)
          : [...parts, action]
        ).join('; '),
      };
    });
  }

  function updateRuleLabelAction(labelName: string) {
    setRuleForm((current) => {
      return {
        ...current,
        action: setRuleActionPart(current.action, 'apply label ', labelName ? `apply label ${labelName}` : ''),
      };
    });
  }

  return {
    ruleForm,
    setRuleForm,
    ruleBuilderField,
    setRuleBuilderField,
    ruleBuilderNeedle,
    setRuleBuilderNeedle,
    editingRuleId,
    setEditingRuleId,
    confirmDeleteRule,
    setConfirmDeleteRule,
    saveRule,
    toggleRule,
    editRule,
    removeRuleConfirmed,
    removeRule,
    updateRuleConditionField,
    updateRuleConditionValue,
    toggleRuleAction,
    updateRuleLabelAction,
  };
}
