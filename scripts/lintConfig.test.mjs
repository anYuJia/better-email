import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const eslint = new ESLint();
async function rules(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  expect(result.messages.filter((message) => message.fatal)).toEqual([]);
  return result.messages.map((message) => message.ruleId);
}

describe('enforced source lint policy', () => {
  it('rejects conditional hooks in production components', async () => {
    expect(await rules('import { useState } from "react"; export function Probe({ open }) { if (open) useState(0); return null; }', 'src/components/Probe.tsx')).toContain('react-hooks/rules-of-hooks');
  });
  it('rejects unhandled promises in the critical workflow hooks', async () => {
    const productionConfig = await eslint.calculateConfigForFile('src/hooks/useMailFeedback.ts');
    expect(productionConfig.rules['@typescript-eslint/no-floating-promises'][0]).toBe(2);
    const filePath = `src/hooks/lint-contract-${randomUUID()}.ts`;
    try {
      await writeFile(filePath, 'Promise.resolve(1); export {};');
      const [result] = await eslint.lintFiles([filePath]);
      expect(result.messages.filter((message) => message.fatal)).toEqual([]);
      expect(result.messages.map((message) => message.ruleId)).toContain('@typescript-eslint/no-floating-promises');
    } finally {
      await rm(filePath, { force: true });
    }
  });
  it('rejects unreachable duplicate branches in build scripts', async () => {
    expect(await rules('export function probe(value) { if (value === 1) return 1; else if (value === 1) return 2; return 0; }', 'scripts/probe.mjs')).toContain('no-dupe-else-if');
  });
});
