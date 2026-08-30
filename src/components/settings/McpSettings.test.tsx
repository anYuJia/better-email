import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import McpSettings from './McpSettings';
import { aiServiceStorageKey } from '../../app/aiServiceConfig';

function seedConfig(config: Record<string, unknown>) {
  window.localStorage.setItem(aiServiceStorageKey, JSON.stringify(config));
}

describe('McpSettings', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('keeps the MCP page focused on enabling and connecting an external service', () => {
    render(<McpSettings />);

    expect(screen.getByText('连接外部 MCP 服务，为 AI 功能提供工具能力。')).not.toBeNull();
    expect((screen.getByRole('checkbox', { name: '启用 MCP' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('配置 MCP 服务端点')).not.toBeNull();
    expect(screen.queryByText('本地演示')).toBeNull();
    expect(screen.queryByText('MCP 网关地址')).toBeNull();
  });

  it('opens the connection guide immediately when MCP is enabled', () => {
    render(<McpSettings />);

    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));

    expect(screen.getByRole('dialog', { name: '连接 MCP 服务' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: '连接信息' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: '初始化与提示词' })).not.toBeNull();
    expect(screen.getByLabelText('MCP 服务端点')).not.toBeNull();
    expect(screen.getByText('保存后 MCP 才会正式启用。')).not.toBeNull();
  });

  it('rolls back an unfinished enable when the guide is dismissed', () => {
    render(<McpSettings />);

    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));
    fireEvent.change(screen.getByLabelText('MCP 服务端点'), {
      target: { value: 'https://mcp.example.com/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog', { name: '连接 MCP 服务' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: '启用 MCP' }) as HTMLInputElement).checked).toBe(false);
  });

  it('closes only when the backdrop is clicked and supports Escape', () => {
    const { container } = render(<McpSettings />);
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));

    const backdrop = container.querySelector('.settings-mcp-guide-backdrop');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(screen.queryByRole('dialog', { name: '连接 MCP 服务' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '连接 MCP 服务' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: '启用 MCP' }) as HTMLInputElement).checked).toBe(false);
  });

  it('copies the initialization prompt without exposing a saved token', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    seedConfig({
      enabled: true,
      serviceType: 'http',
      mcpEnabled: true,
      mcpEndpoint: 'https://mcp.example.com/mcp',
      privacyAcknowledged: true,
    });

    render(<McpSettings />);
    fireEvent.click(screen.getByRole('button', { name: '查看连接信息' }));
    fireEvent.click(screen.getByRole('tab', { name: '初始化与提示词' }));

    const prompt = screen.getByLabelText('初始化连接提示词') as HTMLTextAreaElement;
    expect(prompt.value).toContain('initialize');
    expect(prompt.value).toContain('notifications/initialized');
    expect(prompt.value).not.toContain('mcp-secret');

    fireEvent.click(screen.getByRole('button', { name: '复制提示词' }));
    await waitFor(() => expect(screen.getByText('已复制')).not.toBeNull());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('initialize'));
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('mcp-secret'));
  });
});
