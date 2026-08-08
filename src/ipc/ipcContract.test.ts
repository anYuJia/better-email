import { describe, expect, it } from 'vitest';
import { IPC } from '../ipc/commands';
import { handlers as messageHandlers } from '../mockTauri/messageHandlers';
import { handlers as accountHandlers } from '../mockTauri/accountHandlers';
import { handlers as syncHandlers } from '../mockTauri/syncHandlers';
import { handlers as attachmentHandlers } from '../mockTauri/attachmentHandlers';
import { handlers as contactRuleHandlers } from '../mockTauri/contactRuleHandlers';
import { handlers as aiHandlers } from '../mockTauri/aiHandlers';
import { handlers as miscHandlers } from '../mockTauri/miscHandlers';
import { routeCommand } from '../mockTauri/router';

describe('IPC 契约一致性', () => {
  const mockHandlers = {
    ...messageHandlers,
    ...accountHandlers,
    ...syncHandlers,
    ...attachmentHandlers,
    ...contactRuleHandlers,
    ...aiHandlers,
    ...miscHandlers,
  };

  it('IPC 常量表与 mockTauri 注册的命令完全一致', () => {
    const declared = new Set(Object.values(IPC));
    const registered = new Set(Object.keys(mockHandlers));
    const missing = [...declared].filter((name) => !registered.has(name));
    expect(missing, `mock 缺少 handler: ${missing.join(', ')}`).toEqual([]);
  });

  it('未知命令在 mock 模式显式抛错而不是静默返回 undefined', () => {
    expect(() => routeCommand('no_such_command_ever', {})).toThrow(/Unknown IPC command/);
  });

  it('mock 能响应每个已声明命令（不抛未知命令错误）', () => {
    for (const name of Object.values(IPC)) {
      expect(() => routeCommand(name), `命令 ${name} 应注册 handler`).not.toThrow(/Unknown IPC command/);
    }
  });
});
