import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AccountScope, MailRule, MailRuleInput } from '../../app/types';
import RuleAutomationSettings from './RuleAutomationSettings';

const validRule: MailRuleInput = {
  name: '标记账单邮件',
  condition: 'from contains billing@example.com',
  action: 'mark read',
  enabled: true,
};

function renderSettings(
  ruleForm: MailRuleInput,
  onSaveRule: () => Promise<void> = async () => undefined,
  options: { accountScope?: AccountScope; rules?: MailRule[] } = {},
) {
  return render(
    <RuleAutomationSettings
      accountScope={options.accountScope ?? 1}
      ruleForm={ruleForm}
      ruleBuilderField="from"
      ruleBuilderNeedle={ruleForm.condition.replace(/^from contains\s*/i, '')}
      editingRuleId={null}
      labels={[]}
      rules={options.rules ?? []}
      onRuleFormChange={() => undefined}
      onRuleConditionFieldChange={() => undefined}
      onRuleConditionValueChange={() => undefined}
      onRuleLabelActionChange={() => undefined}
      onToggleRuleAction={() => undefined}
      onSaveRule={onSaveRule}
      onToggleRule={() => undefined}
      onEditRule={() => undefined}
      onRemoveRule={() => undefined}
    />,
  );
}

describe('RuleAutomationSettings', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows a field-level error instead of silently ignoring an incomplete rule', () => {
    const saveRule = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderSettings({ ...validRule, name: '' }, saveRule);

    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));

    expect(screen.getByText('请填写规则名称。')).not.toBeNull();
    expect(saveRule).not.toHaveBeenCalled();
  });

  it('validates the builder keyword and concrete processing action', () => {
    const saveRule = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderSettings({ ...validRule, condition: 'from contains ', action: 'apply label ' }, saveRule);

    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));
    expect(screen.getByText('请填写要匹配的关键词、邮箱或地址。')).not.toBeNull();
    expect(saveRule).not.toHaveBeenCalled();
  });

  it('surfaces a save failure within the rule editor', async () => {
    renderSettings(validRule, async () => {
      throw new Error('规则服务暂时不可用');
    });

    fireEvent.click(screen.getByRole('button', { name: '新增规则' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('规则服务暂时不可用');
    });
  });

  it('only shows rules belonging to the selected account', () => {
    const accountOneRule: MailRule = {
      id: 1,
      account_id: 1,
      name: '账号一规则',
      condition: 'from contains one@example.com',
      action: 'mark read',
      enabled: true,
    };
    const accountTwoRule: MailRule = {
      ...accountOneRule,
      id: 2,
      account_id: 2,
      name: '账号二规则',
    };
    renderSettings(validRule, async () => undefined, {
      accountScope: 1,
      rules: [accountOneRule, accountTwoRule],
    });

    expect(screen.getByText('账号一规则')).not.toBeNull();
    expect(screen.queryByText('账号二规则')).toBeNull();
    expect(screen.getByText('1 条规则')).not.toBeNull();
  });
});
