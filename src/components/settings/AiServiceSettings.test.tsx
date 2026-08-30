import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

  it('shows the AI access page without a service type selector', () => {
    render(<AiServiceSettings />);
    expect(screen.getByText('AI 功能')).not.toBeNull();
    expect(screen.getByText('服务与模型')).not.toBeNull();
    expect(screen.getByText('OpenAI 兼容 API')).not.toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('does not expose MCP or local demo as AI access options', () => {
    seedConfig({ enabled: true, serviceType: 'http', endpoint: 'https://api.example.com/v1' });
    render(<AiServiceSettings />);
    expect(screen.queryByText('MCP 服务')).toBeNull();
    expect(screen.queryByText('本地演示')).toBeNull();
  });

  it('shows the status with 未启用 when the service is off', () => {
    seedConfig({ enabled: false, serviceType: 'http' });
    render(<AiServiceSettings />);
    expect(screen.getByText('未启用')).not.toBeNull();
    expect(screen.getByText('用于翻译、摘要、模板生成。')).not.toBeNull();
  });

  it('keeps internal mock compatibility without exposing local demo in the UI', () => {
    seedConfig({ enabled: true, serviceType: 'mock' });
    render(<AiServiceSettings />);
    expect(screen.queryByText('本地演示')).toBeNull();
    expect(screen.getByText('OpenAI 兼容 API')).not.toBeNull();
    expect(screen.getByText('外部服务隐私')).not.toBeNull();
  });

  it('shows the privacy confirmation area for external service modes', () => {
    seedConfig({ enabled: true, serviceType: 'http', endpoint: 'https://api.example.com/v1' });
    render(<AiServiceSettings />);
    expect(screen.getByText('外部服务隐私')).not.toBeNull();
    expect(screen.getByText('允许向此服务发送邮件内容')).not.toBeNull();
    expect(screen.getByText(/相关邮件内容与提示词会发送到你配置的服务/)).not.toBeNull();
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
