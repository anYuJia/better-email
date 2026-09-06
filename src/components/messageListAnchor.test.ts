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
});
