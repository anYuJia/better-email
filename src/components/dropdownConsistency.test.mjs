import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function runtimeComponentFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeComponentFiles(path);
    if (!/\.(tsx|jsx)$/.test(entry.name) || /\.test\.(tsx|jsx)$/.test(entry.name)) return [];
    return [path];
  });
}

describe('dropdown consistency contract', () => {
  it('does not leave runtime JSX on the operating-system native select menu', () => {
    const offenders = runtimeComponentFiles(srcRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      return source.includes('<select') ? [relative(srcRoot, path)] : [];
    });

    expect(offenders).toEqual([]);
  });
});
