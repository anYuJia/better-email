import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');

/**
 * 邮件列表正文预览必须固定为一行：
 * white-space: nowrap + overflow: hidden + text-overflow: ellipsis。
 * 2026 pass 层已合并进 message-list.css，这里代表"唯一实际生效的级联"：
 * 三件套规则存在且不重复、无 text-wrap 冲突、不以 !important 取胜。
 */
function extractRule(css, selector) {
  const blocks = [];
  const pattern = new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`, 'g');
  let match;
  while ((match = pattern.exec(css)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

const css = readFileSync(join(stylesDir, 'message-list.css'), 'utf8');

describe('message list preview single-line rule', () => {
  const blocks = extractRule(css, '.message-card p');

  it('keeps .message-card p clipping in the shared typography contract', () => {
    expect(blocks.length).toBeGreaterThan(0);
    const complete = blocks.find(
      (b) =>
        b.includes('white-space: nowrap') &&
        b.includes('overflow: hidden') &&
        b.includes('text-overflow: ellipsis'),
    );
    expect(complete, 'message-list.css 必须有一处完整单行三件套').toBeDefined();
  });

  it('does not duplicate truncation declarations', () => {
    const withClip = blocks.filter(
      (b) =>
        b.includes('white-space: nowrap') ||
        b.includes('overflow: hidden') ||
        b.includes('text-overflow: ellipsis'),
    );
    expect(withClip.length, '截断三件套只允许收口一次').toBe(1);
  });

  it('removes the text-wrap: pretty conflict from the final cascade layer', () => {
    for (const block of blocks) {
      expect(block).not.toContain('text-wrap');
    }
  });

  it('does not rely on !important to win the cascade', () => {
    for (const block of blocks) {
      expect(block).not.toContain('!important');
    }
  });
});
