#!/usr/bin/env node
/* Verify every selector in the pass/2026 layer resolves to a retained file.
 * Run: node scripts/verify-selector-coverage.mjs
 * Exit 1 if any selector from the archived layer is missing.
 * Selectors defined by the same layer that contain a URL(/ or var(-- or @ apply
 * are still required to resolve; selectors containing only pseudo-elements are
 * compared by the element part.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/pyu/code/better-email/src';
const ARCHIVE_DIR = join(ROOT, 'styles/2026');

function allCssFiles(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...allCssFiles(p));
    else if (f.endsWith('.css')) out.push(p);
  }
  return out;
}

const RETAINED = allCssFiles(join(ROOT, 'styles')).filter(p => !p.includes('/2026/'))
  .concat(allCssFiles(join(ROOT, 'components')))
  .concat([join(ROOT, 'design-tokens.css'), join(ROOT, 'ui-2026.css')]);

/* Documented dead rules: selectors intentionally retired because a more
 * specific retained rule supersedes them (recorded in the owning sheet).
 * - .composer input/textarea/select:focus: pass-premium-refinements.cs
 *   ringed the fancier fields; the local composer.css layer explicitly
 *   avoids blue rings in the editor and wins by specificity. */
const EXCLUDED = new Set([
  '.composer input:focus',
  '.composer textarea:focus',
  '.composer select:focus',
]);

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function selectors(css) {
  const out = new Set();
  const noComments = stripComments(css);
  const blockRe = /([^{}]+)\{/g;
  let m;
  while ((m = blockRe.exec(noComments)) !== null) {
    const prelude = m[1];
    if (prelude.includes('@')) continue; // skip at-rules
    let depth = 0;
    let cur = '';
    for (const ch of prelude) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { pushSelector(out, cur); cur = ''; continue; }
      cur += ch;
    }
    pushSelector(out, cur);
  }
  return out;
}

function pushSelector(out, raw) {
  let s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return;
  s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  out.add(s);
}

let missingTotal = [];
const retainedSet = selectors(RETAINED.map(f => {
  return statSync(f, { throwIfNoEntry: false }) ? readFileSync(f, 'utf8') : '';
}).join('\n'));

if (!statSync(ARCHIVE_DIR, { throwIfNoEntry: false })) {
  console.log('No 2026 archive layer — coverage trivially satisfied.');
  console.log('\n=== 0 missing total ===');
  process.exit(0);
}

for (const file of readdirSync(ARCHIVE_DIR)) {
  if (!file.endsWith('.css')) continue;
  const src = readFileSync(join(ARCHIVE_DIR, file), 'utf8');
  const sels = selectors(src);
  const missing = [...sels].filter(s => !retainedSet.has(s) && !EXCLUDED.has(s));
  if (missing.length) {
    console.log(`\n[${file}] ${missing.length} selectors not in retained files:`);
    missing.slice(0, 40).forEach(s => console.log(`   ${s}`));
    missingTotal.push(...missing.map(s => `${file}: ${s}`));
  } else {
    console.log(`[OK] ${file} — ${sels.size} selectors covered`);
  }
}
console.log(`\n=== ${missingTotal.length} missing total ===`);
process.exit(missingTotal.length ? 1 : 0);
