import { describe, expect, it } from 'vitest';
import { anchoredScrollTop } from './messageListAnchor';
const rows = (keys: string[]) => keys.map((key) => ({ key }));
const layout = (length: number) => Array.from({ length }, (_, i) => ({ top: i * 80, height: 80 }));

describe('message identity scroll anchors', () => {
  it('preserves the visible message and offset when new mail is inserted above it', () => {
    expect(anchoredScrollTop(rows(['a','b','c']), layout(3), rows(['new','a','b','c']), layout(4), 100)).toBe(180);
  });
  it('keeps the inbox at the top when the user is already at the top', () => {
    expect(anchoredScrollTop(rows(['a']), layout(1), rows(['new','a']), layout(2), 0)).toBe(0);
  });
  it('uses the next surviving row when the anchored message is removed', () => {
    expect(anchoredScrollTop(rows(['a','b','c','d']), layout(4), rows(['a','c','d']), layout(3), 100)).toBe(20);
  });
  it('does not jump for read/star updates that keep the same identities', () => {
    expect(anchoredScrollTop(rows(['a','b','c']), layout(3), rows(['a','b','c']), layout(3), 117)).toBe(117);
  });
  it('handles large folders without depending on mounted virtual rows', () => {
    const keys = Array.from({length: 50_000}, (_, i) => String(i));
    expect(anchoredScrollTop(rows(keys), layout(keys.length), rows(['new',...keys]), layout(keys.length + 1), 2_800_003)).toBe(2_800_083);
  });
  it('keeps stable identities sublinear when only row heights change', () => {
    let keyReads = 0;
    const previous = Array.from({ length: 50_000 }, (_, index) => ({ key: String(index) }));
    const next = previous.map((row) => ({ get key() { keyReads += 1; return row.key; } }));
    const before = layout(previous.length);
    const after = before.map((row) => ({ top: row.top * 1.2, height: row.height * 1.2 }));
    expect(anchoredScrollTop(previous, before, next, after, 2_800_003)).toBe(3_360_003);
    expect(keyReads).toBeLessThan(10);
  });
  it('reuses the caller index after an insertion instead of rescanning every row', () => {
    let keyReads = 0;
    const previous = rows(Array.from({ length: 50_000 }, (_, index) => String(index)));
    const next = [{ key: 'new' }, ...previous].map((row) => ({ get key() { keyReads += 1; return row.key; } }));
    const indexes = new Map(next.map((row, index) => [row.key, index]));
    keyReads = 0;
    expect(anchoredScrollTop(previous, layout(previous.length), next, layout(next.length), 2_800_003, indexes)).toBe(2_800_083);
    expect(keyReads).toBeLessThan(10);
  });
});
