import { emptyDraft } from './appConfig';
import type { Account, DraftInput } from './types';

export function createProviderWriteValidationId(now: Date = new Date()): string {
  return now.toISOString().replace(/\D/g, '').slice(0, 14);
}

export function buildProviderWriteValidationDraft(
  account: Account,
  validationId: string = createProviderWriteValidationId(),
): DraftInput {
  const safeValidationId = validationId.trim() || createProviderWriteValidationId();
  return {
    ...emptyDraft,
    account_id: account.id,
    to: account.email,
    subject: `[Better Email 验收] ${safeValidationId}`,
    body: [
      'Better Email 服务商写入验收',
      '',
      `验证编号：${safeValidationId}`,
      `账号：${account.email}`,
      '',
      '发送前确认',
      '1. 收件人应保持为当前账号，避免向第三方发送测试内容。',
      '2. 如需验证附件，请手动添加一个不含敏感信息的小文件。',
      '3. 不要在主题、正文或附件中粘贴密码、授权码或 Token。',
      '',
      '发送后检查',
      '1. SMTP 接受邮件，本地状态进入已发送或留档待重试。',
      '2. IMAP Sent 留档成功，远端已发送目录可看到同一验证编号。',
      '3. 自发自收邮件进入收件箱，正文和可选附件可正常读取。',
      '4. 已读、星标、归档与恢复操作可以回写远端。',
      '',
      '此草稿不会自动发送；请检查后在撰写器中手动点击发送。',
    ].join('\n'),
  };
}
