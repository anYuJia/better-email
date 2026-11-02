import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import McpSettings from './McpSettings';
import { IPC } from '../../ipc/commands';
import { aiServiceStorageKey } from '../../app/aiServiceConfig';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('../../tauriBridge', () => ({ invoke: invokeMock }));

async function waitUntilLoaded() {
  await waitFor(() => expect((screen.getByRole('checkbox', { name: '启用 MCP' }) as HTMLInputElement).disabled).toBe(false));
}

function seedConfig(config: Record<string, unknown>) {
  window.localStorage.setItem(aiServiceStorageKey, JSON.stringify(config));
}

describe('McpSettings', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === IPC.LoadAiSettings) return { configured: false };
      if (command === IPC.SaveAiSettings) return 'AI 服务设置已保存。';
      if (command === IPC.TestAiConnection) return { ok: false, service_type: 'mcp', message: 'Token 无效', latency_ms: 0 };
      throw new Error(`Unexpected IPC: ${command}`);
    });
  });
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

  it('opens the connection guide immediately when MCP is enabled', async () => {
    render(<McpSettings />);

    await waitUntilLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));

    expect(screen.getByRole('dialog', { name: '连接 MCP 服务' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: '连接信息' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: '初始化与提示词' })).not.toBeNull();
    expect(screen.getByLabelText('MCP 服务端点')).not.toBeNull();
    expect(screen.getByText('保存后 MCP 才会正式启用。')).not.toBeNull();
  });

  it('rolls back an unfinished enable when the guide is dismissed', async () => {
    render(<McpSettings />);

    await waitUntilLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));
    fireEvent.change(screen.getByLabelText('MCP 服务端点'), {
      target: { value: 'https://mcp.example.com/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByRole('dialog', { name: '连接 MCP 服务' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: '启用 MCP' }) as HTMLInputElement).checked).toBe(false);
  });

  it('closes only when the backdrop is clicked and supports Escape', async () => {
    const { container } = render(<McpSettings />);
    await waitUntilLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));

    const backdrop = container.querySelector('.settings-mcp-guide-backdrop');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(screen.queryByRole('dialog', { name: '连接 MCP 服务' })).toBeNull();

    await waitUntilLoaded();
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
    await waitUntilLoaded();
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

  it('persists disabling MCP and restores the switch if saving fails', async () => {
    seedConfig({ enabled: true, serviceType: 'mcp', mcpEnabled: true, mcpEndpoint: 'https://example.com/mcp' });
    render(<McpSettings />);
    await waitUntilLoaded();
    invokeMock.mockRejectedValueOnce(new Error('保存失败'));
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: '启用 MCP' }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(IPC.SaveAiSettings, {
      input: expect.objectContaining({ mcp_enabled: false, service_type: 'http' }),
    }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: '启用 MCP' }) as HTMLInputElement).checked).toBe(false));
    expect(JSON.parse(window.localStorage.getItem(aiServiceStorageKey)!).mcpEnabled).toBe(false);
  });

  it('shows connection errors and permits testing before enabling AI', async () => {
    seedConfig({ enabled: false, mcpEnabled: true, mcpEndpoint: 'http://127.0.0.1:8080/mcp' });
    render(<McpSettings />);
    await waitUntilLoaded();
    fireEvent.click(screen.getByRole('button', { name: '查看连接信息' }));
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await waitFor(() => expect(screen.getByText('Token 无效')).not.toBeNull());
    expect(screen.getAllByText('连接失败').length).toBeGreaterThan(0);
  });

  it('keeps the guide open and blocks dismissal while settings are being saved', async () => {
    render(<McpSettings />);
    await waitUntilLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '启用 MCP' }));
    fireEvent.change(screen.getByLabelText('MCP 服务端点'), { target: { value: 'https://example.com/mcp' } });
    let rejectSave!: (reason: Error) => void;
    invokeMock.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    fireEvent.click(screen.getByRole('button', { name: '保存并启用' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '连接 MCP 服务' })).not.toBeNull();
    expect((screen.getByLabelText('MCP 服务端点') as HTMLInputElement).disabled).toBe(true);
    rejectSave(new Error('端点已更改，请重新输入 Token'));
    await waitFor(() => expect(screen.getByText('端点已更改，请重新输入 Token')).not.toBeNull());
    expect(screen.getByRole('dialog', { name: '连接 MCP 服务' })).not.toBeNull();
  });

  it('never exposes a newly entered token in the summary or copied connection details', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = render(<McpSettings />);
    await waitUntilLoaded();
    fireEvent.click(screen.getByRole('button', { name: '开始配置' }));
    fireEvent.change(screen.getByLabelText('访问 Token'), { target: { value: 'private-new-token' } });
    expect(screen.getByText('待保存')).not.toBeNull();
    expect(container.querySelector('.settings-mcp-connection-preview')?.textContent).not.toContain('private-new-token');
    fireEvent.click(screen.getByRole('button', { name: '复制信息' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).not.toContain('private-new-token');
  });

  it('supports Home and End tab navigation and restores keyboard focus after cancellation', async () => {
    render(<McpSettings />);
    await waitUntilLoaded();
    const start = screen.getByRole('button', { name: '开始配置' });
    start.focus();
    fireEvent.click(start);
    fireEvent.keyDown(screen.getByRole('tab', { name: '连接信息' }), { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: '初始化与提示词' })));
    fireEvent.keyDown(screen.getByRole('tab', { name: '初始化与提示词' }), { key: 'Home' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: '连接信息' })));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(document.activeElement).toBe(start));
  });
});
