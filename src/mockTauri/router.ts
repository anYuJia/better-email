import type { InvokeArgs, MockCommandHandler } from './types';
import { handlers as messageHandlers } from './messageHandlers';
import { handlers as accountHandlers } from './accountHandlers';
import { handlers as syncHandlers } from './syncHandlers';
import { handlers as attachmentHandlers } from './attachmentHandlers';
import { handlers as contactRuleHandlers } from './contactRuleHandlers';
import { handlers as miscHandlers } from './miscHandlers';

const handlers: Record<string, MockCommandHandler> = {
  ...messageHandlers,
  ...accountHandlers,
  ...syncHandlers,
  ...attachmentHandlers,
  ...contactRuleHandlers,
  ...miscHandlers,
};

export function routeCommand(command: string, args?: InvokeArgs): unknown {
  const handler = handlers[command];
  if (handler) return handler(args);
  return Array.isArray(args) ? [] : undefined;
}
