import { mockSetTrayUnreadCount, mockWindowChromeReady } from './state';
import type { MockCommandHandler } from './types';

const mockAiSettingsState = {
  enabled: false,
  service_type: 'http',
  endpoint: '',
  api_key: '',
  model: 'gpt-4o-mini',
  timeout_seconds: 30,
  privacy_acknowledged: false,
  mcp_enabled: false,
  mcp_endpoint: 'http://127.0.0.1:8080/mcp',
  mcp_api_key: '',
};

// 应用全局「默认附件下载位置」：空字符串表示未自定义（使用系统默认）。
const mockAppSettingsState = {
  default_download_dir: '',
};

function mockAppSettingsReport() {
  const configured = mockAppSettingsState.default_download_dir;
  const effective = configured || '/tmp/better-email';
  return {
    configured_dir: configured,
    effective_dir: effective,
    using_default: configured === '',
  };
}

export const handlers: Record<string, MockCommandHandler> = {
  'open_url': (args) => {
    console.log('Mock opening URL:', args?.url);
    return undefined;
  },
  'set_tray_unread_count': mockSetTrayUnreadCount,
  'window_chrome_ready': mockWindowChromeReady,
  'save_ai_settings': (args) => {
    const input = args?.input as Record<string, unknown> | undefined;
    if (!input) throw new Error('缺少 AI 设置输入。');
    Object.assign(mockAiSettingsState, {
      enabled: Boolean(input.enabled),
      service_type: String(input.service_type ?? 'http'),
      endpoint: String(input.endpoint ?? ''),
      api_key: String(input.api_key ?? ''),
      model: String(input.model ?? 'gpt-4o-mini'),
      timeout_seconds: Number(input.timeout_seconds ?? 30),
      privacy_acknowledged: Boolean(input.privacy_acknowledged),
      mcp_enabled: Boolean(input.mcp_enabled),
      mcp_endpoint: String(input.mcp_endpoint ?? ''),
      mcp_api_key: String(input.mcp_api_key ?? ''),
    });
    return 'AI 服务设置已保存。';
  },
  'load_ai_settings': () => ({ ...mockAiSettingsState }),
  'get_app_settings': () => mockAppSettingsReport(),
  'set_download_dir': (args) => {
    if (args?.cancel === true) {
      return { settings: mockAppSettingsReport(), cancelled: true };
    }
    // 模拟原生文件夹选择器：默认选中一个可写的目录，测试可通过 path 指定。
    const selected = typeof args?.path === 'string' && args.path.trim()
      ? args.path.trim()
      : '/mock/downloads/better-email';
    mockAppSettingsState.default_download_dir = selected;
    return { settings: mockAppSettingsReport(), cancelled: false };
  },
  'reset_download_dir': () => {
    mockAppSettingsState.default_download_dir = '';
    return mockAppSettingsReport();
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
