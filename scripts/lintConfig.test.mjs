import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

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
    expect(await rules('Promise.resolve(1); export {};', 'src/hooks/useMailFeedback.ts')).toContain('@typescript-eslint/no-floating-promises');
  });
  it('rejects unreachable duplicate branches in build scripts', async () => {
    expect(await rules('export function probe(value) { if (value === 1) return 1; else if (value === 1) return 2; return 0; }', 'scripts/probe.mjs')).toContain('no-dupe-else-if');
  });
});
