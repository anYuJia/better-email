#!/usr/bin/env node
/* Extract rule blocks from an archived pass file whose selectors do NOT
 * appear in any retained file, ordered as in source, preserving section
 * comments. Outputs standalone CSS (no wrapper) to stdout.
 *
 * Usage: node extract-missing.mjs <pass-file> <retained-dirs...>
 */
import { readFileSync } from 'node:fs';

const [, , passPath, ...retainedDirs] = process.argv;
const src = readFileSync(passPath, 'utf8');

let retained = '';
for (const d of retainedDirs) {
  const { readdirSync, statSync } = await import('node:fs');
  for (const f of readdirSync(d)) {
    if (!f.endsWith('.css')) continue;
    const p = `${d}/${f}`;
    if (statSync(p).isFile()) retained += readFileSync(p, 'utf8') + '\n';
  }
}

const tokens = [];
const re = /(\/\*[\s\S]*?\*\/)|([^{}]+(?:\{[^{}]*\}[^{}]*)*\{[^{}]*\})/g;
let m;
while ((m = re.exec(src)) !== null) {
  const comment = m[1];
  const block = m[2];
  if (comment) { tokens.push({ kind: 'comment', text: comment }); continue; }
  if (!block) continue;
  const brace = block.lastIndexOf('{');
  const prelude = block.slice(0, brace);
  const body = block.slice(brace);
  if (prelude.includes('@')) { tokens.push({ kind: 'raw', text: block }); continue; }
  const sels = prelude.split(',').map(s => s.trim()).filter(Boolean);
  const covered = sels.filter(s => !retained.includes(s));
  if (covered.length) {
    tokens.push({ kind: 'rule', text: `${covered.join(',\n')}${body}` });
  }
}

let out = '';
let lastComment = null;
for (const t of tokens) {
  if (t.kind === 'comment') lastComment = t.text;
  if (t.kind === 'rule') {
    if (lastComment) { out += `\n${lastComment}\n`; lastComment = null; }
    out += `${t.text.trim()}\n`;
  }
}
console.log(out);