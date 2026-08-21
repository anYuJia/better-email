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

  it('shows friendly service type labels and MCP client section', () => {
    render(<AiServiceSettings />);
    expect(screen.getByText(/模型推理服务 \(LLM\)/)).not.toBeNull();
    expect(screen.getByText(/MCP 服务 \(Model Context Protocol\)/)).not.toBeNull();
  });

  it('allows MCP to be selected as the active inference engine', () => {
    seedConfig({
      enabled: true,
      serviceType: 'mcp',
      mcpEnabled: true,
      mcpEndpoint: 'http://127.0.0.1:8080/mcp',
      privacyAcknowledged: true,
    });
    render(<AiServiceSettings />);
    expect(screen.getByRole('combobox').textContent).toContain('MCP 服务器');
    expect(screen.getByDisplayValue('http://127.0.0.1:8080/mcp')).not.toBeNull();
    expect(screen.getByText('Bearer 鉴权 Token')).not.toBeNull();
    expect(screen.getByText(/当前已选择 MCP 服务器作为推理引擎/)).not.toBeNull();
  });

  it('offers MCP in the inference engine selector', () => {
    seedConfig({ enabled: true, serviceType: 'http', endpoint: 'https://api.example.com/v1' });
    render(<AiServiceSettings />);
    fireEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: /MCP 服务器/ })).not.toBeNull();
  });

  it('configures MCP as a client endpoint rather than a local gateway', () => {
    render(<AiServiceSettings />);
    // 不再宣称本地暴露 MCP HTTP 服务（无 listener）。
    expect(screen.queryByText('开启 MCP 网关服务')).toBeNull();
    expect(screen.queryByText(/本地暴露/)).toBeNull();
    expect(screen.queryByText('MCP 网关地址')).toBeNull();
    // 保留实际存在的 MCP 客户端能力配置。
    expect(screen.getByText('启用 MCP 服务')).not.toBeNull();
    expect(screen.getByText(/连接外部 MCP 服务器/)).not.toBeNull();
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
