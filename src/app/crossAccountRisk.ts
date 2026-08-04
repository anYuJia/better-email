import type { Account } from './types/account';
import type { DraftInput } from './types/composer';

export type CrossAccountRiskItem = {
  id: string;
  message: string;
  detail: string;
};

export type CrossAccountRiskContext = {
  originalMessageAccountId: number | null;
  contextAccountId: number | null;
};

function accountEmailSet(accounts: Account[], excludeId: number): Set<string> {
  return new Set(
    accounts
      .filter((entry) => entry.id !== excludeId)
      .map((entry) => entry.email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function recipientsOf(draft: DraftInput): Array<{ field: string; email: string }> {
  const results: Array<{ field: string; email: string }> = [];
  const fields: Array<{ field: string; value: string }> = [
    { field: '收件人', value: draft.to },
    { field: '抄送', value: draft.cc },
    { field: '密送', value: draft.bcc },
  ];
  for (const { field, value } of fields) {
    for (const part of value.split(/[,;，；]/)) {
      const email = part.trim();
      if (email.includes('@')) {
        results.push({ field, email: email.toLowerCase() });
      }
    }
  }
  return results;
}

export function analyzeCrossAccountRisks(
  draft: DraftInput,
  accounts: Account[],
  context: CrossAccountRiskContext,
): CrossAccountRiskItem[] {
  const senderAccount = accounts.find((entry) => entry.id === draft.account_id)
    ?? (draft.account_id === 0 ? accounts[0] : null);
  if (!senderAccount) return [];
  if (senderAccount.cross_account_risk_warning === false) return [];

  const risks: CrossAccountRiskItem[] = [];
  const senderLabel = senderAccount.display_name || senderAccount.email;

  if (
    context.originalMessageAccountId !== null
    && context.originalMessageAccountId !== senderAccount.id
  ) {
    const original = accounts.find((entry) => entry.id === context.originalMessageAccountId);
    if (original) {
      risks.push({
        id: 'reply-account-mismatch',
        message: '正在回复其他账号的邮件',
        detail: `该邮件来自「${original.display_name || original.email}」，但当前发件账号是「${senderLabel}」。对方可能无法识别你的回复身份。`,
      });
    }
  }

  const otherAccountEmails = accountEmailSet(accounts, senderAccount.id);
  if (otherAccountEmails.size > 0) {
    for (const { field, email } of recipientsOf(draft)) {
      if (otherAccountEmails.has(email)) {
        risks.push({
          id: 'self-recipient-other-account',
          message: `${field}中包含你的其他账号地址`,
          detail: `${email} 是你的另一个账号地址，但当前发件账号是「${senderLabel}」。这会把邮件发到自己的其他账号，可能不是你的本意。`,
        });
        break;
      }
    }
  }

  if (
    context.contextAccountId !== null
    && context.contextAccountId !== senderAccount.id
    && context.contextAccountId !== context.originalMessageAccountId
  ) {
    const contextAccount = accounts.find((entry) => entry.id === context.contextAccountId);
    if (contextAccount) {
      risks.push({
        id: 'context-account-mismatch',
        message: '快捷写信来源账号与发件账号不一致',
        detail: `内容来自「${contextAccount.display_name || contextAccount.email}」的场景，但当前发件账号是「${senderLabel}」。`,
      });
    }
  }

  return risks;
}

export function riskSummary(risks: CrossAccountRiskItem[]): string {
  return risks.map((risk) => risk.message).join('；');
}
