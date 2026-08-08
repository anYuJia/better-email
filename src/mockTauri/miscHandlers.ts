import type { InvokeArgs, MockCommandHandler } from './types';

export const handlers: Record<string, MockCommandHandler> = {
  'open_url': (args) => {
    console.log('Mock opening URL:', args?.url);
    return undefined;
  },
  'export_diagnostics': () => JSON.stringify({ app_version: '0.1.0', accounts: [{ email_masked: 'd***@better-email.local' }] }, null, 2),
  'parse_raw_message': () => ({
    subject: '安全预览样例',
    from: 'sender@example.com',
    to: 'demo@better-email.local',
    body_preview: '这是一封用于验证 MIME/HTML 安全预览的原始邮件。',
    sanitized_html: '<img><p>这是一封用于验证 MIME/HTML 安全预览的原始邮件。</p>',
    attachment_count: 1,
    attachment_names: ['security-checklist.pdf'],
    warning_count: 2,
    warnings: ['检测到远程图片，应默认阻止自动加载。', 'HTML 正文包含 script 标签，渲染前必须清洗。'],
  }),
};
