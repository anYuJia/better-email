import type { MailRuleInput } from './types';

export const emptyRuleForm: MailRuleInput = {
  name: '',
  condition: 'from contains ',
  action: 'apply label ',
  enabled: true,
};

export type RuleConditionField = 'from' | 'subject' | 'body' | 'to';

export const ruleConditionFields: { id: RuleConditionField; label: string }[] = [
  { id: 'from', label: '发件人' },
  { id: 'subject', label: '主题' },
  { id: 'body', label: '正文' },
  { id: 'to', label: '收件人' },
];

export const ruleActionPresets = [
  { id: 'mark read', label: '标为已读' },
  { id: 'star', label: '加星标' },
  { id: 'move to archive', label: '归档' },
  { id: 'move to trash', label: '移到废纸篓' },
  { id: 'stop processing', label: '停止后续规则' },
];

export function parseRuleCondition(condition: string): { field: RuleConditionField; value: string } {
  const normalized = condition.trim();
  const match = normalized.match(/^(from|subject|body|to|sender|recipients)\s+contains\s+(.*)$/i);
  if (!match) return { field: 'from', value: '' };
  const fieldAlias = match[1].toLowerCase();
  const field: RuleConditionField =
    fieldAlias === 'sender' ? 'from' : fieldAlias === 'recipients' ? 'to' : (fieldAlias as RuleConditionField);
  return { field, value: match[2] ?? '' };
}

export function buildRuleCondition(field: RuleConditionField, value: string): string {
  return `${field} contains ${value}`;
}

export function ruleActionParts(action: string): string[] {
  return action
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function setRuleActionPart(action: string, prefix: string, nextPart: string): string {
  const parts = ruleActionParts(action).filter((part) => !part.toLowerCase().startsWith(prefix.toLowerCase()));
  const trimmedPart = nextPart.trim();
  if (trimmedPart) parts.unshift(trimmedPart);
  return parts.join('; ');
}
