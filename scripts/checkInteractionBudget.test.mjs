import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from 'vitest';

test('interaction guard rejects missing data and severe regressions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'better-email-budget-'));
  try {
    const path = join(dir, 'report.json');
    const run = report => {
      writeFileSync(path, JSON.stringify(report));
      return spawnSync(process.execPath, ['scripts/check-interaction-budget.mjs', path]).status;
    };
    const report = { status: 'ok', kind: 'mock-browser-quality-matrix', interactions: { samples: 24, cachedSwitchPaintP95Ms: 40 } };
    expect(run(report)).toBe(0);
    expect(run({ ...report, interactions: { samples: 24, cachedSwitchPaintP95Ms: 501 } })).not.toBe(0);
    expect(run({ ...report, interactions: { samples: 0 } })).not.toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
