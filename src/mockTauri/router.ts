import type { InvokeArgs, MockCommandHandler } from './types';
import { handlers as messageHandlers } from './messageHandlers';
import { handlers as accountHandlers } from './accountHandlers';
import { handlers as syncHandlers } from './syncHandlers';
import { handlers as attachmentHandlers } from './attachmentHandlers';
import { handlers as contactRuleHandlers } from './contactRuleHandlers';
import { handlers as aiHandlers } from './aiHandlers';
import { handlers as miscHandlers } from './miscHandlers';

const handlers: Record<string, MockCommandHandler> = {
  ...messageHandlers,
  ...accountHandlers,
  ...syncHandlers,
  ...attachmentHandlers,
  ...contactRuleHandlers,
  ...aiHandlers,
  ...miscHandlers,
};

export function routeCommand(command: string, args?: InvokeArgs): unknown {
  const handler = handlers[command];
  if (handler) return handler(args);
  throw new Error(`Unknown IPC command in mock mode: '${command}'. 该命令未在 mockTauri 注册，请先在 src/mockTauri 补 handler。`);
}
