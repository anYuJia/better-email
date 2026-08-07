import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AiServiceSettings from './AiServiceSettings';
import { aiServiceStorageKey } from '../../app/aiServiceConfig';

function seedConfig(config: Record<string, unknown>) {
  window.localStorage.setItem(aiServiceStorageKey, JSON.stringify(config));
}

describe('AiServiceSettings', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('shows friendly service type labels', () => {
    render(<AiServiceSettings />);
    expect(screen.getByText('本地演示模式')).not.toBeNull();
    expect(screen.getByText('OpenAI 兼容接口')).not.toBeNull();
    expect(screen.getByText('MCP 服务')).not.toBeNull();
    expect(screen.getByText('高级')).not.toBeNull();
  });

  it('marks MCP as an advanced option', () => {
    render(<AiServiceSettings />);
    const mcpLabel = screen.getByText('MCP 服务').closest('button');
    expect(mcpLabel?.textContent).toContain('高级');
  });

  it('shows the status with 未启用 when the service is off', () => {
    seedConfig({ enabled: false, serviceType: 'http' });
    render(<AiServiceSettings />);
    expect(screen.getByText('未启用')).not.toBeNull();
    expect(screen.getAllByText(/可用功能：翻译、摘要、模板生成/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows 本地演示 status and no external privacy confirmation in mock mode', () => {
    seedConfig({ enabled: true, serviceType: 'mock' });
    render(<AiServiceSettings />);
    expect(screen.getByText('本地演示')).not.toBeNull();
    expect(screen.queryByText('隐私确认')).toBeNull();
    expect(screen.queryByText(/我已阅读并同意将邮件内容发送到外部 AI 服务/)).toBeNull();
    expect(screen.getAllByText(/不会向任何外部服务器发送内容/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/本地模拟服务/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the privacy confirmation area for external service modes', () => {
    seedConfig({ enabled: true, serviceType: 'http', endpoint: 'https://api.example.com/v1' });
    render(<AiServiceSettings />);
    expect(screen.getByText('隐私确认')).not.toBeNull();
    expect(screen.getByText(/我已阅读并同意将邮件内容发送到外部 AI 服务/)).not.toBeNull();
    expect(screen.getByText(/邮件正文或提示词可能发送到配置的服务/)).not.toBeNull();
  });

  it('keeps test connection and save actions available', () => {
    seedConfig({ enabled: true, serviceType: 'mock' });
    render(<AiServiceSettings />);
    expect(screen.getByRole('button', { name: /测试连接/ })).not.toBeNull();
    expect(screen.getByRole('button', { name: /保存设置/ })).not.toBeNull();
  });

  it('dimms the configuration area while the service is disabled', () => {
    seedConfig({ enabled: false, serviceType: 'http' });
    const { container } = render(<AiServiceSettings />);
    const area = container.querySelector('.settings-ai-config-area');
    expect(area?.className).toContain('is-dimmed');
  });
});
