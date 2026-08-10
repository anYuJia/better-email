import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', '2026');

/**
 * 邮件列表正文预览必须固定为一行：
 * white-space: nowrap + overflow: hidden + text-overflow: ellipsis。
 * 项目存在多层样式覆盖（styles.css 与 ui-2026.css 系列），
 * 这里断言所有实际生效的 .message-card p 规则收敛为同一三件套。
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

function readCss(name) {
  return readFileSync(join(stylesDir, name), 'utf8');
}

describe('message list preview single-line rule', () => {
  const cascadeOrder = [
    'message-list.css',
    'pass-message-list-density.css',
    'pass-message-list-final.css',
    'pass-refinement.css',
    'workspace-hierarchy.css',
  ];

  it('keeps white-space: nowrap in every effective .message-card p rule', () => {
    for (const name of cascadeOrder) {
      const blocks = extractRule(readCss(name), '.message-card p');
      expect(blocks.length, `${name} 应有 .message-card p 规则`).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block, `${name} 必须保持单行`).toContain('white-space: nowrap');
        expect(block).toContain('overflow: hidden');
        expect(block).toContain('text-overflow: ellipsis');
      }
    }
  });

  it('removes the text-wrap: pretty conflict from the final cascade layer', () => {
    for (const block of extractRule(readCss('workspace-hierarchy.css'), '.message-card p')) {
      expect(block).not.toContain('text-wrap');
    }
  });

  it('does not rely on !important to win the cascade', () => {
    for (const name of cascadeOrder) {
      for (const block of extractRule(readCss(name), '.message-card p')) {
        expect(block, `${name} 不应使用 !important`).not.toContain('!important');
      }
    }
  });
});
