import { beforeEach, describe, expect, it } from 'vitest';
import {
  messages,
  resetMockMessages,
  snoozeMessagesMockMessage,
} from './state';

describe('snoozeMessagesMockMessage 批量稍后处理原子性', () => {
  beforeEach(() => {
    resetMockMessages();
  });

  it('全部 ID 有效时一次性移动全部目标，并按请求顺序返回', () => {
    const beforeIds = messages.map((message) => message.id);
    const result = snoozeMessagesMockMessage({
      messageIds: [1, 2],
      snoozedUntil: '2030-01-01T09:00',
    });

    expect(result.map((message) => message.id)).toEqual([1, 2]);
    expect(result.every((message) => message.folder_role === 'snoozed')).toBe(true);
    expect(messages.map((message) => message.id)).toEqual(beforeIds);
    expect(messages.filter((message) => message.folder_role === 'snoozed').length).toBe(2);
  });

  it('有效 ID + 不存在 ID 失败后 mock 数据完全不变（原子回滚）', () => {
    const before = JSON.stringify(messages);
    expect(() =>
      snoozeMessagesMockMessage({
        messageIds: [1, 999999],
        snoozedUntil: '2030-01-01T09:00',
      }),
    ).toThrow('message not found');
    expect(JSON.stringify(messages)).toBe(before);
  });

  it('重复 ID 只返回同一封的多个副本，且只移动一次', () => {
    const result = snoozeMessagesMockMessage({
      messageIds: [1, 1],
      snoozedUntil: '2030-01-01T09:00',
    });

    expect(result.map((message) => message.id)).toEqual([1, 1]);
    expect(result[0]).toBe(result[1]);
    expect(messages.filter((message) => message.folder_role === 'snoozed').length).toBe(1);
  });
});
