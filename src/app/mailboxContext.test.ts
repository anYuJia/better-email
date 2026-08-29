import { describe, expect, it } from 'vitest';
import { buildMailboxContextKey } from './mailboxContext';

describe('buildMailboxContextKey', () => {
  it('distinguishes data contexts but keeps the reader cache across list modes', () => {
    const base = { accountScope: 1, folderId: 101, query: '', filter: 'all' as const, listMode: 'messages' as const };
    expect(buildMailboxContextKey(base)).toBe('1|101||all');
    expect(buildMailboxContextKey({ ...base, accountScope: 'all' })).not.toBe(buildMailboxContextKey(base));
    expect(buildMailboxContextKey({ ...base, folderId: 102 })).not.toBe(buildMailboxContextKey(base));
    expect(buildMailboxContextKey({ ...base, filter: 'unread' })).not.toBe(buildMailboxContextKey(base));
    expect(buildMailboxContextKey({ ...base, listMode: 'threads' })).toBe(buildMailboxContextKey(base));
  });

  it('normalizes search queries so casing and padding do not invalidate the cache', () => {
    expect(buildMailboxContextKey({ accountScope: 1, folderId: 101, query: '  Quarterly ', filter: 'all', listMode: 'messages' }))
      .toBe(buildMailboxContextKey({ accountScope: 1, folderId: 101, query: 'quarterly', filter: 'all', listMode: 'messages' }));
    expect(buildMailboxContextKey({ accountScope: 1, folderId: 101, query: 'quarterly', filter: 'all', listMode: 'messages' }))
      .not.toBe(buildMailboxContextKey({ accountScope: 1, folderId: 101, query: 'security', filter: 'all', listMode: 'messages' }));
  });

  it('treats missing folder id consistently', () => {
    const a = buildMailboxContextKey({ accountScope: 'all', folderId: null, query: '', filter: 'all', listMode: 'messages' });
    const b = buildMailboxContextKey({ accountScope: 'all', folderId: undefined as unknown as number | null, query: '', filter: 'all', listMode: 'messages' });
    expect(a).toBe(b);
  });

  it('does not invalidate reader data when only the list presentation changes', () => {
    const messages = buildMailboxContextKey({ accountScope: 1, folderId: 101, query: '', filter: 'all', listMode: 'messages' });
    const threads = buildMailboxContextKey({ accountScope: 1, folderId: 101, query: '', filter: 'all', listMode: 'threads' });
    expect(threads).toBe(messages);
  });
});
